import { Types } from "mongoose";
import { z } from "zod";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { deleteB2Object } from "@/src/lib/backblaze";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import { getCloudinary, getCloudinaryErrorMessage } from "@/src/lib/cloudinary";
import { removeEmptyUploadMemories } from "@/src/lib/memory-cleanup";
import { connectToDatabase } from "@/src/lib/mongodb";
import { MediaAsset } from "@/src/models/MediaAsset";
import { Memory } from "@/src/models/Memory";

export const runtime = "nodejs";

const schema = z.union([
  z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(5000) }),
  z.object({ allImages: z.literal(true) }),
  z.object({ allMedia: z.literal(true) }),
]);

export async function DELETE(request: Request) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to delete media.", 401);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return errorJson("Choose media files to delete.", 400);
    await connectToDatabase();

    const spaceFilter = { spaceId: auth.membership.spaceId, status: "ready" as const };
    let assets;
    if ("allImages" in parsed.data || "allMedia" in parsed.data) {
      const ownMemories = auth.membership.role === "owner" ? [] : await Memory.find({
        spaceId: auth.membership.spaceId, createdBy: auth.user._id,
      }).distinct("_id");
      const baseFilter = {
        ...spaceFilter,
        ...( "allImages" in parsed.data ? { resourceType: "image" as const } : {}),
      };
      assets = await MediaAsset.find(auth.membership.role === "owner"
        ? baseFilter
        : { ...baseFilter, $or: [{ uploadedBy: auth.user._id }, { memoryId: { $in: ownMemories } }] });
    } else {
      const ids = [...new Set(parsed.data.ids)].map((id) => new Types.ObjectId(id));
      assets = await MediaAsset.find({ ...spaceFilter, _id: { $in: ids } });
      if (assets.length !== ids.length) return errorJson("One or more selected images are unavailable.", 404);

      if (auth.membership.role !== "owner") {
        const ownMemories = await Memory.find({
          spaceId: auth.membership.spaceId, createdBy: auth.user._id,
        }).distinct("_id");
        const canDelete = new Set(assets.filter((asset) =>
          String(asset.uploadedBy) === String(auth.user._id) ||
          Boolean(asset.memoryId && ownMemories.some((id) => String(id) === String(asset.memoryId))),
        ).map((asset) => String(asset._id)));
        if (canDelete.size !== assets.length) return errorJson("You don't have permission to delete one or more selected images.", 403);
      }
    }

    let cloudinary: ReturnType<typeof getCloudinary>["cloudinary"] | undefined;
    const failures: string[] = [];
    const failureMessages: string[] = [];
    const deletedIds: string[] = [];
    const deletedAssets: Array<{ memoryId?: Types.ObjectId; originalFilename: string }> = [];
    let cloudinaryActionDisabled = false;
    for (let start = 0; start < assets.length; start += 8) {
      await Promise.all(assets.slice(start, start + 8).map(async (asset) => {
        try {
          if (asset.provider === "backblaze") {
            await deleteB2Object(asset.storageKey ?? asset.publicId);
          } else {
            cloudinary ??= getCloudinary().cloudinary;
            const result = await cloudinary.uploader.destroy(asset.publicId, {
              resource_type: asset.resourceType, type: "authenticated", invalidate: true,
            });
            if (result.result !== "ok" && result.result !== "not found") {
              failures.push(String(asset._id));
              failureMessages.push(`Cloudinary returned ${result.result ?? "no deletion result"}.`);
              return;
            }
          }
          await Memory.updateMany(
            { spaceId: auth.membership.spaceId, mediaAssetIds: asset._id },
            { $pull: { mediaAssetIds: asset._id } },
          );
          await asset.deleteOne();
          deletedIds.push(String(asset._id));
          deletedAssets.push({ memoryId: asset.memoryId, originalFilename: asset.originalFilename });
        } catch (error) {
          failures.push(String(asset._id));
          const message = getCloudinaryErrorMessage(error);
          if (asset.provider === "cloudinary" && message.toLowerCase().includes("action is disabled")) {
            cloudinaryActionDisabled = true;
          }
          failureMessages.push(message);
          console.error("[media-bulk-delete] Cloudinary rejected delete", { mediaId: String(asset._id), message });
        }
      }));
      if (cloudinaryActionDisabled) break;
      }
    await removeEmptyUploadMemories(auth.membership.spaceId, deletedAssets);
    if (failures.length > 0 && deletedIds.length === 0) {
      const reason = cloudinaryActionDisabled
        ? "Cloudinary has disabled actions for this account, so the remaining files were not attempted."
        : failureMessages[0] ?? "Check the Cloudinary account and API key permissions.";
      return errorJson(`Cloudinary could not delete the selected media. ${reason}`, 502);
    }
    return successJson({ deletedIds, failedIds: failures, failureMessages, deletedCount: deletedIds.length, failedCount: failures.length });
  } catch (error) {
    logApiError("media-bulk-delete", error);
    return errorJson("The selected files could not be deleted right now.", 500);
  }
}

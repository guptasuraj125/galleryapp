import { Types } from "mongoose";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { deleteB2Object } from "@/src/lib/backblaze";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import { getCloudinary, getCloudinaryErrorMessage } from "@/src/lib/cloudinary";
import { removeEmptyUploadMemories } from "@/src/lib/memory-cleanup";
import { connectToDatabase } from "@/src/lib/mongodb";
import { MediaAsset } from "@/src/models/MediaAsset";
import { Memory } from "@/src/models/Memory";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ mediaId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(_request)) return errorJson("Invalid request origin.", 403);
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to delete media.", 401);
    const { mediaId } = await context.params;
    if (!/^[a-f\d]{24}$/i.test(mediaId)) return errorJson("This media could not be found.", 404);
    await connectToDatabase();
    const asset = await MediaAsset.findOne({
      _id: new Types.ObjectId(mediaId),
      spaceId: auth.membership.spaceId,
      status: "ready",
    });
    if (!asset) return errorJson("This media could not be found.", 404);
    if (
      auth.membership.role !== "owner" &&
      String(asset.uploadedBy) !== String(auth.user._id) &&
      !(asset.memoryId && String((await Memory.findById(asset.memoryId).select("createdBy"))?.createdBy) === String(auth.user._id))
    ) {
      return errorJson("You don't have permission to delete this media.", 403);
    }

    try {
      if (asset.provider === "backblaze") {
        await deleteB2Object(asset.storageKey ?? asset.publicId);
      } else {
        const { cloudinary } = getCloudinary();
        const destroyResult = await cloudinary.uploader.destroy(asset.publicId, {
          resource_type: asset.resourceType,
          type: "authenticated",
          invalidate: true,
        });
        if (destroyResult.result !== "ok" && destroyResult.result !== "not found") {
          return errorJson("Cloudinary did not confirm deletion. No database record was removed.", 502);
        }
      }
    } catch (error) {
      const message = getCloudinaryErrorMessage(error);
      console.error(`[media-delete-${asset.provider}] Storage provider rejected delete`, { message });
      return errorJson(`Storage provider could not delete this media: ${message} No database record was removed.`, 502);
    }

    await Memory.updateMany(
      { spaceId: auth.membership.spaceId, mediaAssetIds: asset._id },
      { $pull: { mediaAssetIds: asset._id } },
    );
    await asset.deleteOne();
    await removeEmptyUploadMemories(auth.membership.spaceId, [asset]);
    return successJson({ deleted: true });
  } catch (error) {
    logApiError("media-delete", error);
    return errorJson("This media could not be deleted right now.", 500);
  }
}

import { z } from "zod";
import { deleteB2Object } from "@/src/lib/backblaze";
import { deleteImageKitObject } from "@/src/lib/imagekit";
import { getCurrentUser } from "@/src/lib/auth";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import { getCloudinary } from "@/src/lib/cloudinary";
import { connectToDatabase } from "@/src/lib/mongodb";
import { SpaceMember } from "@/src/models/SpaceMember";
import { UploadItem } from "@/src/models/UploadItem";
import { UploadJob } from "@/src/models/UploadJob";

export const runtime = "nodejs";

const failSchema = z.object({ itemId: z.string().regex(/^[a-f\d]{24}$/i) });

async function failUpload(request: Request) {
  if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return errorJson("Sign in to update this upload.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return errorJson("We couldn't update this upload.", 400);
    throw error;
  }
  const parsed = failSchema.safeParse(body);
  if (!parsed.success) return errorJson("We couldn't update this upload.", 400);

  await connectToDatabase();
  const item = await UploadItem.findById(parsed.data.itemId);
  if (!item) return errorJson("This upload could not be found.", 404);
  const job = await UploadJob.findOne({ _id: item.uploadJobId, userId: user._id });
  if (!job || !(await SpaceMember.exists({ spaceId: job.spaceId, userId: user._id }))) {
    return errorJson("You don't have permission to update this upload.", 403);
  }

  let cleanupPending = false;
  if (item.status !== "completed") {
    try {
      if (item.provider === "imagekit") {
        if (item.status === "processing" && item.storageKey) {
          await deleteImageKitObject(item.publicId, item.storageKey);
        }
      } else if (item.provider === "backblaze") {
        await deleteB2Object(item.storageKey ?? item.publicId);
      } else {
        const { cloudinary } = getCloudinary();
        const result = await cloudinary.uploader.destroy(item.publicId, {
          resource_type: item.resourceType,
          type: "authenticated",
          invalidate: true,
        });
        cleanupPending = result.result !== "ok" && result.result !== "not found";
      }
    } catch (error) {
      cleanupPending = true;
      logApiError("upload-fail-cleanup", error);
    }
    item.status = "failed";
    item.errorMessage = cleanupPending
      ? "Upload failed; remote storage cleanup is pending."
      : "Upload didn't finish.";
    await item.save();
    job.status = "failed";
    await job.save();
  }
  if (cleanupPending) {
    return successJson({ recorded: true, cleanupPending: true });
  }
  return successJson({ recorded: true });
}

export async function POST(request: Request) {
  try {
    return await failUpload(request);
  } catch (error) {
    logApiError("upload-fail", error);
    return errorJson("The failed upload could not be recorded.", 500);
  }
}

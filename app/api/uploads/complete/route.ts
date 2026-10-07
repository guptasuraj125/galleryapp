import mongoose from "mongoose";
import { z } from "zod";
import { verifyB2Object } from "@/src/lib/backblaze";
import { verifyImageKitObject } from "@/src/lib/imagekit";
import { getCurrentUser } from "@/src/lib/auth";
import { getCloudinary } from "@/src/lib/cloudinary";
import { connectToDatabase } from "@/src/lib/mongodb";
import { MediaAsset } from "@/src/models/MediaAsset";
import { Memory } from "@/src/models/Memory";
import { SpaceMember } from "@/src/models/SpaceMember";
import { UploadItem } from "@/src/models/UploadItem";
import { UploadJob } from "@/src/models/UploadJob";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";

export const runtime = "nodejs";

const completeSchema = z.object({ itemId: z.string().regex(/^[a-f\d]{24}$/i) });

interface CloudinaryResource {
  public_id?: string;
  resource_type?: string;
  type?: string;
  format?: string;
  version?: number;
  bytes?: number;
  width?: number;
  height?: number;
  duration?: number;
}

async function completeUpload(request: Request) {
  if (!isSameOrigin(request)) {
    return errorJson("Invalid request origin.", 403);
  }

  const user = await getCurrentUser();
  if (!user) {
    return errorJson("Sign in to finish this upload.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorJson("We couldn't confirm this upload.", 400);
    }
    throw error;
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson("We couldn't confirm this upload.", 400);
  }

  await connectToDatabase();
  const item = await UploadItem.findById(parsed.data.itemId);
  if (!item) {
    return errorJson("This upload could not be found.", 404);
  }

  const job = await UploadJob.findOne({ _id: item.uploadJobId, userId: user._id });
  if (!job) {
    return errorJson("You don't have permission to finish this upload.", 403);
  }
  const membership = await SpaceMember.exists({ spaceId: job.spaceId, userId: user._id });
  if (!membership) {
    return errorJson("You don't have permission to finish this upload.", 403);
  }
  if (item.status === "completed" && item.mediaAssetId) {
    return successJson({ uploaded: true, mediaAssetId: item.mediaAssetId.toString() });
  }

  let format = item.originalFilename.split(".").pop()?.toLowerCase();
  let bytes: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let duration: number | undefined;
  let imageKitFileId: string | undefined;
  let imageKitFilePath: string | undefined;
  const allowedFormats =
    item.resourceType === "image"
      ? ["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif"]
      : ["mp4", "mov", "webm"];
  if (item.provider === "imagekit") {
    try {
      if (!item.publicId || item.status !== "processing") {
        return errorJson("ImageKit did not identify the uploaded file.", 400);
      }
      const object = await verifyImageKitObject(item.publicId);
      imageKitFileId = object.fileId;
      imageKitFilePath = object.filePath;
      bytes = object.size;
      width = object.width;
      height = object.height;
      duration = object.duration;
      const normalizedPath = object.filePath?.replace(/^\/+/, "");
      const normalizedStorageKey = item.storageKey?.replace(/^\/+/, "");
      const expectedFileType = item.resourceType === "image" ? "image" : "non-image";
      if (
        object.fileId !== item.publicId ||
        object.fileType !== expectedFileType ||
        object.size !== item.expectedBytes ||
        !normalizedStorageKey ||
        normalizedPath !== normalizedStorageKey
      ) {
        return errorJson("ImageKit received an unexpected asset or content type.", 422);
      }
    } catch (error) {
      logApiError("upload-complete-imagekit-verify", error);
      return errorJson("ImageKit could not verify the uploaded object. Please retry.", 502);
    }
  } else if (item.provider === "cloudinary") {
    let cloudinary;
    try {
      cloudinary = getCloudinary().cloudinary;
    } catch (error) {
      logApiError("upload-complete-cloudinary-config", error);
      return errorJson("Cloudinary isn't configured to complete this older upload.", 503);
    }
    let resource: CloudinaryResource;
    try {
      resource = (await cloudinary.api.resource(item.publicId, {
        resource_type: item.resourceType,
        type: "authenticated",
      })) as CloudinaryResource;
    } catch (error) {
      logApiError("upload-complete-cloudinary-verify", error);
      return errorJson("That file didn't finish uploading. Please retry it.", 502);
    }
    format = resource.format?.toLowerCase();
    bytes = resource.bytes;
    width = resource.width;
    height = resource.height;
    duration = resource.duration;
    if (resource.public_id !== item.publicId || resource.resource_type !== item.resourceType || resource.type !== "authenticated") {
      format = undefined;
    }
  } else {
    try {
      const object = await verifyB2Object(item.storageKey ?? item.publicId);
      bytes = object.ContentLength;
      if (object.ContentType !== item.contentType || bytes !== item.expectedBytes) {
        return errorJson("Backblaze received a file with unexpected size or content type.", 422);
      }
    } catch (error) {
      logApiError("upload-complete-backblaze-verify", error);
      return errorJson("Backblaze could not verify the uploaded object. Please retry.", 502);
    }
  }
  if (
    !format ||
    !allowedFormats.includes(format) ||
    !Number.isSafeInteger(bytes) ||
    !bytes ||
    bytes > 500 * 1024 * 1024
  ) {
    console.error("[upload] Uploaded object failed verification", {
      uploadItemId: item.id,
      provider: item.provider,
      category: "asset-validation",
    });
    await UploadItem.updateOne(
      { _id: item._id, status: { $ne: "completed" } },
      { $set: { status: "failed", errorMessage: "Uploaded file failed verification." } },
    );
    await UploadJob.updateOne(
      { _id: job._id },
      { $set: { status: "failed" } },
    );
    return errorJson("That file couldn't be verified. Please retry it.", 422);
  }

  const databaseSession = await mongoose.startSession();
  let mediaAssetId = "";
  try {
    await databaseSession.withTransaction(async () => {
      const currentItem = await UploadItem.findById(item._id).session(databaseSession);
      if (!currentItem) {
        throw new Error("Upload item disappeared while it was being completed.");
      }
      if (currentItem.status === "completed" && currentItem.mediaAssetId) {
        mediaAssetId = currentItem.mediaAssetId.toString();
        return;
      }

      let asset = await MediaAsset.findOne({
        spaceId: job.spaceId,
        publicId: imageKitFileId ?? item.publicId,
      }).session(databaseSession);
      if (!asset) {
        [asset] = await MediaAsset.create(
          [{
            spaceId: job.spaceId,
            uploadedBy: user._id,
            provider: item.provider,
            publicId: imageKitFileId ?? item.publicId,
            ...(imageKitFilePath ? { storageKey: imageKitFilePath } : item.storageKey ? { storageKey: item.storageKey } : {}),
            resourceType: item.resourceType,
            format,
            bytes,
            width,
            height,
            duration,
            originalFilename: item.originalFilename,
            contentType: item.contentType,
            folderPath: item.folderPath,
            status: "ready",
          }],
          { session: databaseSession },
        );
        const [memory] = await Memory.create(
          [{
            spaceId: job.spaceId,
            createdBy: user._id,
            title: item.originalFilename.replace(/\.[^.]+$/, "").slice(0, 160) || "A little memory",
            occurredAt: new Date(),
            mediaAssetIds: [asset._id],
            tagIds: [],
          }],
          { session: databaseSession },
        );
        asset.memoryId = memory._id;
        await asset.save({ session: databaseSession });
      }

      currentItem.mediaAssetId = asset._id;
      if (imageKitFileId) currentItem.publicId = imageKitFileId;
      if (imageKitFilePath) currentItem.storageKey = imageKitFilePath;
      currentItem.status = "completed";
      currentItem.errorMessage = undefined;
      await currentItem.save({ session: databaseSession });
      await UploadJob.updateOne(
        { _id: job._id },
        { $set: { status: "completed", completedItems: 1 } },
        { session: databaseSession },
      );
      mediaAssetId = asset.id;
    });
  } finally {
    await databaseSession.endSession();
  }

  return successJson({ uploaded: true, mediaAssetId });
}

export async function POST(request: Request) {
  try {
    return await completeUpload(request);
  } catch (error) {
    logApiError("upload-complete", error);
    return errorJson("The upload could not be finalized. Please retry.", 500);
  }
}

import { z } from "zod";
import { createB2Object } from "@/src/lib/backblaze";
import { getCurrentUser } from "@/src/lib/auth";
import { createImageKitObject, deleteImageKitObject } from "@/src/lib/imagekit";
import { connectToDatabase } from "@/src/lib/mongodb";
import { SpaceMember } from "@/src/models/SpaceMember";
import { UploadItem } from "@/src/models/UploadItem";
import { UploadJob } from "@/src/models/UploadJob";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ itemId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  let uploadedAsset: { fileId: string; filePath: string } | undefined;
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const user = await getCurrentUser();
    if (!user) return errorJson("Sign in to upload your memories.", 401);
    const { itemId } = await context.params;
    if (!z.string().regex(/^[a-f\d]{24}$/i).safeParse(itemId).success) {
      return errorJson("This upload could not be found.", 404);
    }

    await connectToDatabase();
    const item = await UploadItem.findById(itemId);
    if (!item || (item.provider !== "imagekit" && item.provider !== "backblaze")) {
      return errorJson("This upload could not be found.", 404);
    }
    const job = await UploadJob.findOne({ _id: item.uploadJobId, userId: user._id });
    if (!job || !(await SpaceMember.exists({ spaceId: job.spaceId, userId: user._id }))) {
      return errorJson("You don't have permission to upload this file.", 403);
    }
    if (item.status !== "uploading") return errorJson("This upload is no longer active.", 409);
    const contentLength = Number(request.headers.get("content-length"));
    if (contentLength !== item.expectedBytes) return errorJson("The file size did not match the selected file.", 400);
    if (request.headers.get("content-type")?.split(";")[0] !== item.contentType) {
      return errorJson("The file type did not match the selected file.", 400);
    }
    if (!request.body || item.expectedBytes <= 0) return errorJson("The selected file was empty.", 400);
    if (item.provider === "backblaze") {
      await createB2Object(
        item.storageKey ?? item.publicId,
        item.contentType,
        item.expectedBytes,
        request.body,
      );
      item.status = "processing";
      await item.save();
      return successJson({ uploaded: true });
    }
    if (!item.storageKey) {
      throw new Error("The upload record is missing its ImageKit target path.");
    }
    const pathParts = item.storageKey.split("/");
    const fileName = pathParts.pop();
    if (!fileName || pathParts.length < 2) {
      throw new Error("The upload record contains an invalid ImageKit target path.");
    }

    const uploaded = await createImageKitObject(
      fileName,
      item.contentType,
      request.body,
      item.expectedBytes,
      `/${pathParts.join("/")}`,
    );
    uploadedAsset = uploaded;
    if (uploaded.filePath.replace(/^\/+/, "") !== item.storageKey.replace(/^\/+/, "")) {
      throw new Error("ImageKit uploaded the file to an unexpected path.");
    }

    item.publicId = uploaded.fileId;
    item.storageKey = uploaded.filePath;
    item.status = "processing";
    await item.save();

    return successJson({ uploaded: true, fileId: uploaded.fileId });
  } catch (error) {
    if (uploadedAsset) {
      try {
        await deleteImageKitObject(uploadedAsset.fileId, uploadedAsset.filePath);
      } catch (cleanupError) {
        logApiError("upload-imagekit-cleanup", cleanupError);
      }
    }
    logApiError("upload-imagekit-content", error);
    return errorJson("The file could not be uploaded to ImageKit. Please retry.", 502);
  }
}

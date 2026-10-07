import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getImageKit, makeImageKitObjectKey } from "@/src/lib/imagekit";
import { getCurrentUser } from "@/src/lib/auth";
import { connectToDatabase } from "@/src/lib/mongodb";
import { consumeRateLimit } from "@/src/lib/rate-limit";
import { PrivateSpace } from "@/src/models/PrivateSpace";
import { SpaceMember } from "@/src/models/SpaceMember";
import { UploadItem } from "@/src/models/UploadItem";
import { UploadJob } from "@/src/models/UploadJob";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const uploadSchema = z.object({
  filename: z.string().min(1).max(512),
  contentType: z.string().max(127),
  bytes: z.number().int().positive().max(MAX_FILE_BYTES),
  folderPath: z.string().max(500).optional(),
});

const supportedTypes: Record<string, { resourceType: "image" | "video"; contentType: string }> = {
  jpg: { resourceType: "image", contentType: "image/jpeg" },
  jpeg: { resourceType: "image", contentType: "image/jpeg" },
  png: { resourceType: "image", contentType: "image/png" },
  webp: { resourceType: "image", contentType: "image/webp" },
  gif: { resourceType: "image", contentType: "image/gif" },
  avif: { resourceType: "image", contentType: "image/avif" },
  heic: { resourceType: "image", contentType: "image/heic" },
  heif: { resourceType: "image", contentType: "image/heif" },
  mp4: { resourceType: "video", contentType: "video/mp4" },
  mov: { resourceType: "video", contentType: "video/quicktime" },
  webm: { resourceType: "video", contentType: "video/webm" },
};

function safeFilename(filename: string): string {
  return (filename.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
}

async function initiateUpload(request: Request) {
  if (!isSameOrigin(request)) {
    return errorJson("Invalid request origin.", 403);
  }

  const user = await getCurrentUser();
  if (!user) {
    return errorJson("Sign in to upload your memories.", 401);
  }

  const limit = await consumeRateLimit(`upload:${user.id}`, 5000, 6 * 60 * 60 * 1000);
  if (!limit.allowed) {
    return errorJson("Too many uploads. Please try again shortly.", 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorJson("Choose a valid file to upload.", 400);
    }
    throw error;
  }

  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson("Choose a supported photo or video no larger than 500 MB.", 400);
  }

  const filename = safeFilename(parsed.data.filename);
  const folderPath = (parsed.data.folderPath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[\u0000-\u001f\u007f]/g, "").trim())
    .filter(Boolean)
    .join("/")
    .slice(0, 500);
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = supportedTypes[extension];
  if (!filename || !mediaType) {
    return errorJson("Use a JPG, PNG, WEBP, GIF, AVIF, HEIC, HEIF, MP4, MOV, or WEBM file.", 400);
  }
  if (
    parsed.data.contentType &&
    parsed.data.contentType !== "application/octet-stream" &&
    parsed.data.contentType !== mediaType.contentType
  ) {
    return errorJson("The file type does not match its extension.", 400);
  }

  await connectToDatabase();
  const membership = await SpaceMember.findOne({ userId: user._id }).sort({ joinedAt: 1 });
  if (!membership) {
    return errorJson("Your account is not part of a private space.", 403);
  }
  const space = await PrivateSpace.findById(membership.spaceId).select("_id");
  if (!space) {
    return errorJson("Your private space could not be found.", 404);
  }

  try {
    getImageKit();
  } catch (error) {
    logApiError("upload-initiate-imagekit-config", error);
    return errorJson("ImageKit isn't configured. Add the IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT variables and restart the app.", 503);
  }

  let uploadJobId: string | undefined;
  try {
    const uploadJob = await UploadJob.create({
      spaceId: space._id,
      userId: user._id,
      status: "uploading",
      totalItems: 1,
      completedItems: 0,
      idempotencyKey: randomUUID(),
    });
    uploadJobId = uploadJob.id;
  const storageKey = makeImageKitObjectKey(space.id, filename, folderPath);
  const uploadItem = await UploadItem.create({
    uploadJobId: uploadJob._id,
    publicId: randomUUID(),
    storageKey,
    provider: "imagekit",
    resourceType: mediaType.resourceType,
    contentType: mediaType.contentType,
    originalFilename: filename,
    expectedBytes: parsed.data.bytes,
    status: "uploading",
    folderPath,
  });
  return successJson({
    itemId: uploadItem.id,
    uploadUrl: `/api/uploads/content/${uploadItem.id}`,
    resourceType: mediaType.resourceType,
    contentType: mediaType.contentType,
  });
  } catch (error) {
    if (uploadJobId) {
      await UploadJob.updateOne(
        { _id: uploadJobId, userId: user._id },
        { $set: { status: "failed" } },
      );
    }
    logApiError("upload-initiate", error);
    return errorJson("The upload could not be prepared. Please try again.", 500);
  }
}

export async function POST(request: Request) {
  try {
    return await initiateUpload(request);
  } catch (error) {
    logApiError("upload-initiate", error);
    return errorJson("The upload could not be prepared. Please try again.", 500);
  }
}

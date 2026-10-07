import { z } from "zod";
import { getCurrentUser } from "@/src/lib/auth";
import { createB2Object } from "@/src/lib/backblaze";
import { connectToDatabase } from "@/src/lib/mongodb";
import { SpaceMember } from "@/src/models/SpaceMember";
import { UploadItem } from "@/src/models/UploadItem";
import { UploadJob } from "@/src/models/UploadJob";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ itemId: string }> };

export async function PUT(request: Request, context: RouteContext) {
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
    if (!item || item.provider !== "backblaze") return errorJson("This upload could not be found.", 404);
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
    if (!request.body) return errorJson("The selected file was empty.", 400);

    await createB2Object(item.publicId, item.contentType, item.expectedBytes, request.body);
    return successJson({ uploaded: true });
  } catch (error) {
    logApiError("upload-b2-content", error);
    return errorJson("The file could not be uploaded to Backblaze B2. Please retry.", 502);
  }
}

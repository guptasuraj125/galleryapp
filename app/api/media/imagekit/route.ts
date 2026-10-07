import { NextResponse } from "next/server";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { errorJson, logApiError } from "@/src/lib/api-response";
import { getImageKitObjectMetadata, getImageKitSignedDeliveryUrl } from "@/src/lib/imagekit";
import { connectToDatabase } from "@/src/lib/mongodb";
import { MediaAsset } from "@/src/models/MediaAsset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedTypes = new Set(["image", "video"]);
const allowedVariants = new Set(["original", "thumbnail", "poster"]);

function isSafeImageKitPath(path: string) {
  return path.length > 0 &&
    path.length <= 500 &&
    path.split("/").every((part) =>
      Boolean(part) && part !== "." && part !== ".." && /^[a-zA-Z0-9._-]+$/.test(part),
    );
}

export async function GET(request: Request) {
  try {
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to view this media.", 401);

    const url = new URL(request.url);
    const path = url.searchParams.get("path")?.trim() ?? "";
    const requestedType = url.searchParams.get("type") ?? "image";
    const variant = url.searchParams.get("variant") ?? "original";

    if (!isSafeImageKitPath(path)) return errorJson("This media path is invalid.", 400);
    if (!allowedTypes.has(requestedType)) return errorJson("This media type is invalid.", 400);
    if (!allowedVariants.has(variant)) return errorJson("This media variant is invalid.", 400);
    if (variant === "thumbnail" && requestedType !== "image") {
      return errorJson("This media variant is invalid.", 400);
    }
    if (variant === "poster" && requestedType !== "video") {
      return errorJson("This media variant is invalid.", 400);
    }

    await connectToDatabase();
    const asset = await MediaAsset.findOne({
      spaceId: auth.membership.spaceId,
      provider: "imagekit",
      status: "ready",
      resourceType: requestedType,
      $or: [
        { storageKey: path },
        { storageKey: `/${path}` },
        { publicId: path },
      ],
    }).select("publicId storageKey resourceType").lean();

    if (!asset) return errorJson("This media could not be found.", 404);

    const file = await getImageKitObjectMetadata(asset.publicId);
    const storedPath = String(asset.storageKey ?? "").replace(/^\/+/, "");
    const imageKitPath = String(file.filePath ?? "").replace(/^\/+/, "");

    if (!storedPath || imageKitPath !== storedPath || file.fileType !== asset.resourceType) {
      console.error("[imagekit-delivery] Asset metadata mismatch", {
        assetId: String((asset as { _id?: unknown })._id ?? ""),
        publicId: asset.publicId,
        storedPath,
        imageKitPath,
        storedType: asset.resourceType,
        imageKitType: file.fileType,
      });
      return errorJson("This media could not be verified.", 409);
    }

    const signedUrl = await getImageKitSignedDeliveryUrl(
      asset.publicId,
      imageKitPath,
      asset.resourceType,
      variant as "thumbnail" | "poster" | "original",
    );

    const response = NextResponse.redirect(signedUrl, 302);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    logApiError("imagekit-media-delivery", error);
    return errorJson("This media could not be loaded right now.", 502);
  }
}

import "server-only";
import { v2 as cloudinary } from "cloudinary";

const assetVersionCache = new Map<string, number>();

export function getCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary server configuration is incomplete.");
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return { cloudinary, cloudName, apiKey, apiSecret };
}

export function getCloudinaryErrorMessage(error: unknown) {
  let value: unknown = error;
  if (value && typeof value === "object" && "error" in value) value = value.error;
  if (value && typeof value === "object" && "error" in value) value = value.error;
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value.slice(0, 180) : "Cloudinary rejected the request.";
  }
  const detail = value as { message?: unknown; http_code?: unknown; code?: unknown };
  const message = typeof detail.message === "string" ? detail.message.slice(0, 180) : "Cloudinary rejected the request.";
  const code = typeof detail.http_code === "number" ? detail.http_code
    : typeof detail.code === "number" || typeof detail.code === "string" ? detail.code : undefined;
  return `${code ? `HTTP ${code}: ` : ""}${message}`;
}

export function getAuthenticatedDeliveryUrls(
  publicId: string,
  resourceType: "image" | "video",
  format?: string,
  version?: number,
) {
  const { cloudinary } = getCloudinary();
  const versionOption = version ? { version } : {};
  const assetUrl = cloudinary.url(publicId, {
    secure: true,
    type: "authenticated",
    resource_type: resourceType,
    sign_url: true,
    ...(format ? { format } : {}),
    ...versionOption,
  });
  const posterUrl = resourceType === "video"
    ? cloudinary.url(publicId, {
      secure: true,
      type: "authenticated",
      resource_type: "video",
      format: "jpg",
      sign_url: true,
      ...versionOption,
    })
    : undefined;
  return { assetUrl, posterUrl };
}

export async function getAuthenticatedAssetVersion(
  publicId: string,
  resourceType: "image" | "video",
) {
  const key = `${resourceType}:${publicId}`;
  const cached = assetVersionCache.get(key);
  if (cached) return cached;
  const { cloudinary } = getCloudinary();
  const resource = await cloudinary.api.resource(publicId, { resource_type: resourceType, type: "authenticated" });
  if (!Number.isSafeInteger(resource.version) || resource.version < 1) {
    throw new Error("Cloudinary did not return the asset version.");
  }
  assetVersionCache.set(key, resource.version);
  return resource.version as number;
}

export async function listAuthenticatedAssetPublicIds(prefix: string, resourceType: "image" | "video") {
  const { cloudinary } = getCloudinary();
  const publicIds = new Set<string>();
  let nextCursor: string | undefined;
  do {
    const page = await cloudinary.api.resources({
      resource_type: resourceType,
      type: "authenticated",
      prefix,
      max_results: 500,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    });
    for (const asset of page.resources ?? []) {
      if (typeof asset.public_id === "string") publicIds.add(asset.public_id);
    }
    nextCursor = page.next_cursor;
  } while (nextCursor);
  return publicIds;
}

import { getUserSpaceMembership } from "@/src/lib/auth";
import { errorJson, logApiError } from "@/src/lib/api-response";
import { getB2Object, getB2ObjectMetadata } from "@/src/lib/backblaze";
import { connectToDatabase } from "@/src/lib/mongodb";
import { MediaAsset } from "@/src/models/MediaAsset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ByteRange = { start: number; end: number };

function parseByteRange(value: string, length: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || length <= 0 || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, length - suffixLength), end: length - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= length || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, length - 1) };
}

function isSafeObjectKey(key: string) {
  const parts = key.split("/");
  return parts.length === 3 &&
    parts[0] === "memories" &&
    /^[a-f\d]{24}$/i.test(parts[1]) &&
    Boolean(parts[2]) &&
    parts[2] !== "." &&
    parts[2] !== ".." &&
    /^[a-zA-Z0-9._-]+$/.test(parts[2]);
}

function logB2MediaError(
  error: unknown,
  details: { key: string; range: string | null; contentType: string },
) {
  const b2Error = error && typeof error === "object"
    ? error as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown } }
    : undefined;
  console.error("[media-proxy-b2] Object request failed", {
    name: typeof b2Error?.name === "string" ? b2Error.name : "UnknownError",
    ...(typeof b2Error?.$metadata?.httpStatusCode === "number"
      ? { httpStatus: b2Error.$metadata.httpStatusCode }
      : {}),
    ...(typeof b2Error?.Code === "string"
      ? { code: b2Error.Code }
      : typeof b2Error?.code === "string"
        ? { code: b2Error.code }
        : {}),
    ...details,
  });
}

async function serveMedia(request: Request, headOnly: boolean) {
  const auth = await getUserSpaceMembership();
  if (!auth) return errorJson("Sign in to view this media.", 401);

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !isSafeObjectKey(key)) return errorJson("This media key is invalid.", 400);
  const spacePrefix = `memories/${String(auth.membership.spaceId)}/`;
  if (!key.startsWith(spacePrefix)) return errorJson("You don't have permission to view this media.", 403);

  await connectToDatabase();
  const asset = await MediaAsset.findOne({
    spaceId: auth.membership.spaceId,
    provider: "backblaze",
    status: "ready",
    $or: [{ storageKey: key }, { publicId: key }],
  }).select("bytes contentType").lean();
  if (!asset) return errorJson("This media could not be found.", 404);

  const requestRange = headOnly ? null : request.headers.get("range");
  const byteRange = requestRange ? parseByteRange(requestRange, asset.bytes) : null;
  if (requestRange && !byteRange) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Range": `bytes */${asset.bytes}`,
      },
    });
  }

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": asset.contentType,
    "X-Content-Type-Options": "nosniff",
  });

  try {
    if (headOnly) {
      const object = await getB2ObjectMetadata(key);
      headers.set("Content-Type", object.ContentType ?? asset.contentType);
      headers.set("Content-Length", String(object.ContentLength ?? asset.bytes));
      return new Response(null, { status: 200, headers });
    }

    const range = byteRange ? `bytes=${byteRange.start}-${byteRange.end}` : undefined;
    const object = await getB2Object(key, range);
    if (!object.Body) throw new Error("Backblaze returned an empty media body.");

    const contentType = object.ContentType ?? asset.contentType;
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(object.ContentLength ?? (
      byteRange ? byteRange.end - byteRange.start + 1 : asset.bytes
    )));
    if (byteRange) {
      headers.set(
        "Content-Range",
        object.ContentRange ?? `bytes ${byteRange.start}-${byteRange.end}/${asset.bytes}`,
      );
    }
    return new Response(object.Body.transformToWebStream(), {
      status: byteRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    logB2MediaError(error, {
      key,
      range: requestRange,
      contentType: asset.contentType,
    });
    logApiError("media-proxy", error);
    return errorJson("This media could not be loaded right now.", 502);
  }
}

export async function GET(request: Request) {
  try {
    return await serveMedia(request, false);
  } catch (error) {
    logApiError("media-proxy", error);
    return errorJson("This media could not be loaded right now.", 500);
  }
}

export async function HEAD(request: Request) {
  try {
    return await serveMedia(request, true);
  } catch (error) {
    logApiError("media-proxy-head", error);
    return errorJson("This media could not be loaded right now.", 500);
  }
}

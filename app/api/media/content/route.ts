import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { getBackblaze } from "@/src/lib/backblaze";
import { errorJson, logApiError } from "@/src/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedKey(key: string, spaceId: string) {
  return key.startsWith(`memories/${spaceId}/`) && !key.includes("..") && !key.includes("\\");
}

export async function GET(request: Request) {
  try {
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to view this media.", 401);

    const key = new URL(request.url).searchParams.get("key")?.trim();
    if (!key || !isAllowedKey(key, String(auth.membership.spaceId))) {
      return errorJson("This media could not be found.", 404);
    }

    const { client, bucketName } = getBackblaze();
    const range = request.headers.get("range") ?? undefined;
    const result = await client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
      ...(range ? { Range: range } : {}),
    }));

    if (!result.Body) return errorJson("This media is empty.", 404);

    const headers = new Headers();
    if (result.ContentType) headers.set("Content-Type", result.ContentType);
    if (result.ContentLength !== undefined) headers.set("Content-Length", String(result.ContentLength));
    if (result.ContentRange) headers.set("Content-Range", result.ContentRange);
    headers.set("Accept-Ranges", "bytes");
    if (result.ETag) headers.set("ETag", result.ETag);
    headers.set("Cache-Control", "private, max-age=3600");

    return new Response(result.Body.transformToWebStream(), {
      status: result.ContentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    logApiError("b2-media-proxy", error);
    return errorJson("This media could not be loaded right now.", 502);
  }
}

export async function HEAD(request: Request) {
  try {
    const auth = await getUserSpaceMembership();
    if (!auth) return new Response(null, { status: 401 });

    const key = new URL(request.url).searchParams.get("key")?.trim();
    if (!key || !isAllowedKey(key, String(auth.membership.spaceId))) {
      return new Response(null, { status: 404 });
    }

    const { client, bucketName } = getBackblaze();
    const result = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    const headers = new Headers();
    if (result.ContentType) headers.set("Content-Type", result.ContentType);
    if (result.ContentLength !== undefined) headers.set("Content-Length", String(result.ContentLength));
    if (result.ETag) headers.set("ETag", result.ETag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(null, { status: 200, headers });
  } catch (error) {
    logApiError("b2-media-proxy-head", error);
    return new Response(null, { status: 404 });
  }
}

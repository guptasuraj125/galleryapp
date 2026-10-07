import "server-only";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let client: S3Client | undefined;

export function getBackblaze() {
  const accessKeyId = process.env.B2_APPLICATION_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  const bucketName = process.env.B2_BUCKET_NAME;
  const endpoint = process.env.B2_ENDPOINT;
  const region = process.env.B2_REGION;
  if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint || !region) {
    throw new Error("Backblaze B2 is not configured. Set the B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT, and B2_REGION variables.");
  }
  client ??= new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    // Backblaze B2 is S3-compatible but browsers cannot provide custom
    // checksum headers on <img>/<video> requests. Only calculate/validate
    // checksums when the operation explicitly requires them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, bucketName };
}

export function makeB2ObjectKey(spaceId: string, filename: string) {
  const safeName = filename
    .split(/[\\/]/).pop()!
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 160) || "upload";
  return `memories/${spaceId}/${crypto.randomUUID()}-${safeName}`;
}

/**
 * Return an authenticated same-origin URL instead of a direct B2 presigned URL.
 * This avoids B2's S3-compatible checksum/signature incompatibilities with
 * browser <img>/<video> requests and lets the proxy handle HTTP Range requests.
 */
export async function createB2DownloadUrl(key: string, _contentType: string, _filename: string) {
  return `/api/media/content?key=${encodeURIComponent(key)}`;
}

export async function verifyB2Object(key: string) {
  const { client, bucketName } = getBackblaze();
  return client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
}

export async function deleteB2Object(key: string) {
  const { client, bucketName } = getBackblaze();
  await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}

export async function createB2Object(key: string, contentType: string, contentLength: number, body: NonNullable<Request["body"]>) {
  const { client, bucketName } = getBackblaze();
  const { Readable } = await import("node:stream");
  const stream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  return client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    Body: stream,
  }));
}

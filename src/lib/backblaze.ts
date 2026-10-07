import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export async function createB2DownloadUrl(key: string, contentType: string, filename: string) {
  const { client, bucketName } = getBackblaze();
  const safeDispositionName = filename.replace(/[\r\n"\\]/g, "_").slice(0, 200);
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ResponseContentType: contentType,
    ResponseContentDisposition: `inline; filename="${safeDispositionName}"`,
  }), { expiresIn: 60 * 60 * 24 * 7 });
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

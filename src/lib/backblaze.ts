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
    // AWS SDK v3 enables newer S3 checksum behavior by default. Backblaze
    // B2 is S3-compatible but this response-checksum mode can produce
    // x-amz-checksum-mode=ENABLED on presigned GET URLs. A browser <img>
    // or <video> request cannot provide the matching x-amz header, so B2
    // rejects the URL with 403. Only apply checksums when required.
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

export async function createB2DownloadUrl(key: string, contentType: string, _filename: string) {
  const { client, bucketName } = getBackblaze();

  // Backblaze B2's S3 GetObject API does not support the AWS
  // response-content-disposition override. Keep the presigned request
  // limited to parameters B2 documents as supported.
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ResponseContentType: contentType,
  }), { expiresIn: 60 * 60 });
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

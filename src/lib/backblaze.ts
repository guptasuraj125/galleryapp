import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

let client: S3Client | undefined;

export function getBackblaze() {
  const accessKeyId = process.env.B2_APPLICATION_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  const bucketName = process.env.B2_BUCKET_NAME;
  const endpoint = process.env.B2_ENDPOINT;
  const region = process.env.B2_REGION;
  if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint || !region) {
    throw new Error("Backblaze B2 legacy storage is not configured.");
  }

  client ??= new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucketName };
}

export async function getB2Object(key: string, range?: string) {
  const { client, bucketName } = getBackblaze();
  return client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ...(range ? { Range: range } : {}),
  }));
}

export async function getB2ObjectMetadata(key: string) {
  const { client, bucketName } = getBackblaze();
  return client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
}

export async function verifyB2Object(key: string) {
  return getB2ObjectMetadata(key);
}

export async function deleteB2Object(key: string) {
  const { client, bucketName } = getBackblaze();
  await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}

export async function createB2Object(
  key: string,
  contentType: string,
  contentLength: number,
  body: ReadableStream<Uint8Array>,
) {
  const { client, bucketName } = getBackblaze();
  const stream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  return client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    Body: stream,
  }));
}

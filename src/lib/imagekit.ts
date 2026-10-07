import "server-only";
import ImageKit from "@imagekit/nodejs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

let client: ImageKit | undefined;

export function getImageKit() {
  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;

  if (!publicKey || !privateKey || !urlEndpoint) {
    throw new Error("ImageKit is not configured. Set the IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT variables.");
  }

  client ??= new ImageKit({ privateKey });
  return { client, publicKey, privateKey, urlEndpoint };
}

export function makeImageKitObjectKey(spaceId: string, filename: string, folderPath = "") {
  const safeName = filename
    .split(/[\\/]/).pop()!
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 160) || "upload";

  const cleanFolderPath = folderPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.normalize("NFKC").replace(/[^a-zA-Z0-9_-]+/g, "-"))
    .filter(Boolean)
    .join("/");
  return `memories/${spaceId}${cleanFolderPath ? `/${cleanFolderPath}` : ""}/${randomUUID()}-${safeName}`;
}

export function buildImageKitUrl(
  filePath: string,
  resourceType: "image" | "video" = "image",
  variant: "thumbnail" | "poster" | "original" = "original",
) {
  const { client, urlEndpoint } = getImageKit();
  const trimmed = filePath.trim();
  if (!trimmed) return urlEndpoint.replace(/\/+$/, "") + "/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const cleanPath = trimmed.replace(/^\/+/, "");
  const src = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
  if (variant === "thumbnail" && resourceType === "image") {
    return client.helper.buildSrc({
      urlEndpoint,
      src,
      signed: true,
      expiresIn: 3600,
      transformation: [{
        width: 800,
        height: 600,
        crop: "maintain_ratio",
        quality: 80,
        format: "auto",
      }],
    });
  }
  if (variant === "poster" && resourceType === "video") {
    return client.helper.buildSrc({
      urlEndpoint,
      src,
      signed: true,
      expiresIn: 3600,
      transformation: [{ raw: "so-0,w-800,h-450,fo-auto" }],
    });
  }
  if (resourceType === "video") {
    return client.helper.buildSrc({
      urlEndpoint,
      src,
      signed: true,
      expiresIn: 3600,
      transformation: [{ format: "mp4", videoCodec: "h264", audioCodec: "aac" }],
    });
  }
  return client.helper.buildSrc({ urlEndpoint, src, signed: true, expiresIn: 3600 });
}

export async function getImageKitObjectMetadata(fileId: string) {
  const { client } = getImageKit();
  return client.files.get(fileId);
}

export async function verifyImageKitObject(fileId: string) {
  return getImageKitObjectMetadata(fileId);
}

export async function deleteImageKitObject(fileId: string, expectedFilePath?: string) {
  const { client } = getImageKit();
  if (expectedFilePath) {
    const file = await client.files.get(fileId);
    if (file.filePath?.replace(/^\/+/, "") !== expectedFilePath.replace(/^\/+/, "")) {
      throw new Error("The ImageKit asset path does not match the upload record.");
    }
  }
  return client.files.delete(fileId);
}

export async function createImageKitObject(
  fileName: string,
  contentType: string,
  body: ReadableStream<Uint8Array>,
  contentLength: number,
  folder?: string,
) {
  const { privateKey } = getImageKit();
  const boundary = `----ghumi-${randomUUID()}`;
  const safeFileName = fileName.replace(/["\\\r\n]/g, "_");
  const fields = [
    ["fileName", safeFileName],
    ...(folder ? [["folder", folder] as const] : []),
    ["useUniqueFileName", "false"],
    ["overwriteFile", "false"],
    ["isPrivateFile", "true"],
    ["isPublished", "true"],
  ] as const;
  const fieldParts = fields.map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  const fileHeader =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--\r\n`;
  const contentBytes =
    Buffer.byteLength(fieldParts.join("")) +
    Buffer.byteLength(fileHeader) +
    contentLength +
    Buffer.byteLength(closing);

  async function* multipartBody() {
    for (const part of fieldParts) yield Buffer.from(part);
    yield Buffer.from(fileHeader);
    const reader = body.getReader();
    let streamedBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamedBytes += value.byteLength;
        if (streamedBytes > contentLength) {
          throw new Error("The incoming file exceeded its declared content length.");
        }
        yield Buffer.from(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (streamedBytes !== contentLength) {
      throw new Error("The incoming file did not match its declared content length.");
    }
    yield Buffer.from(closing);
  }

  const uploadStream = Readable.toWeb(Readable.from(multipartBody())) as ReadableStream<Uint8Array>;
  const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(contentBytes),
    },
    body: uploadStream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const responseText = await response.text();
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(responseText) as unknown;
  } catch {
    throw new Error(`ImageKit returned a non-JSON response (HTTP ${response.status}): ${responseText.slice(0, 300)}`);
  }
  if (!response.ok) {
    const detail = responseBody && typeof responseBody === "object" && "message" in responseBody &&
      typeof responseBody.message === "string"
      ? responseBody.message
      : JSON.stringify(responseBody).slice(0, 300);
    throw new Error(`ImageKit upload failed (HTTP ${response.status}): ${detail}`);
  }
  if (
    !responseBody ||
    typeof responseBody !== "object" ||
    !("fileId" in responseBody) ||
    typeof responseBody.fileId !== "string" ||
    !("filePath" in responseBody) ||
    typeof responseBody.filePath !== "string"
  ) {
    throw new Error("ImageKit upload response is missing its file ID or file path.");
  }

  return responseBody as {
    fileId: string;
    filePath: string;
    size?: number;
    width?: number;
    height?: number;
    duration?: number;
    mime?: string;
  };
}

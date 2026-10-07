"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, Check, FileVideo2, ImagePlus, LoaderCircle, RotateCcw, X } from "lucide-react";
import { readJson } from "@/src/lib/api-response";
import { BlobReader, BlobWriter, ZipReader, type FileEntry } from "@zip.js/zip.js";

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 2000;
const MAX_ARCHIVE_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH = 20;
const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif", "mp4", "mov", "webm",
]);

type UploadStatus = "queued" | "uploading" | "saving" | "done" | "failed" | "cancelled";

interface UploadEntry {
  id: string;
  file?: File;
  archive?: File;
  archiveEntry?: FileEntry;
  filename: string;
  folderPath?: string;
  contentType: string;
  bytes: number;
  archiveName?: string;
  archiveId?: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

interface ArchiveReport {
  id: string;
  filename: string;
  skipped: number;
  failed: string[];
  uploadFailures: Record<string, string>;
  uploaded: number;
}

interface ArchiveScanResult {
  entries: UploadEntry[];
  skipped: number;
  failed: string[];
  reader?: ZipReader<Blob>;
}

interface UploadTarget {
  error?: string;
  itemId: string;
  uploadUrl: string;
  resourceType: "image" | "video";
  contentType: string;
}

interface JsonResponse {
  error?: string;
  success?: boolean;
}

interface UploadFailureResponse extends JsonResponse {
  cleanupPending?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function validateFile(file: File): string | undefined {
  return validateFileInfo(file.name, file.size);
}

function validateFileInfo(filename: string, size: number): string | undefined {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "Choose a JPG, PNG, WEBP, GIF, AVIF, HEIC, HEIF, MP4, MOV, or WEBM file.";
  }
  if (size === 0) return "This file is empty.";
  if (size > MAX_FILE_BYTES) return "Each file must be smaller than 500 MB.";
  return undefined;
}

function contentTypeFor(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", avif: "image/avif", heic: "image/heic", heif: "image/heif",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  };
  return types[extension] ?? "application/octet-stream";
}

function safeArchivePath(path: string): { valid: boolean; filename: string; folderPath: string } {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const invalid = !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/i.test(normalized) ||
    segments.some((segment) => segment === "..") ||
    segments.length > MAX_ARCHIVE_DEPTH + 1;
  const safeSegments = segments.filter((segment) => segment && segment !== ".");
  return {
    valid: !invalid && safeSegments.length > 0,
    filename: (safeSegments.at(-1) ?? "").slice(0, 255),
    folderPath: safeSegments.slice(0, -1).join("/").slice(0, 500),
  };
}

async function scanArchive(file: File): Promise<ArchiveScanResult> {
  if (file.size === 0 || file.size > MAX_ARCHIVE_BYTES) {
    return { entries: [], skipped: 0, failed: ["Archive must be non-empty and no larger than 500 MB."] };
  }
  const reader = new ZipReader(new BlobReader(file), {
    strictness: "strict",
    checkCrc32: true,
    checkOverlappingEntry: true,
  });
  try {
    const archiveEntries = await reader.getEntries();
    if (archiveEntries.length > MAX_ARCHIVE_FILES) {
      await reader.close();
      return { entries: [], skipped: 0, failed: [`Archive contains more than ${MAX_ARCHIVE_FILES} entries.`] };
    }
    let expandedBytes = 0;
    let skipped = 0;
    const failed: string[] = [];
    const entries: UploadEntry[] = [];

    for (const archiveEntry of archiveEntries) {
      if (archiveEntry.directory) continue;
      const safePath = safeArchivePath(archiveEntry.filename);
      if (!safePath.valid) {
        failed.push(`${archiveEntry.filename.slice(0, 120)}: unsafe path`);
        continue;
      }
      if (archiveEntry.symlink || archiveEntry.executable || archiveEntry.encrypted) {
        skipped += 1;
        continue;
      }
      const validationError = validateFileInfo(safePath.filename, archiveEntry.uncompressedSize);
      if (validationError || archiveEntry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
        skipped += 1;
        continue;
      }
      if (
        archiveEntry.compressedSize === 0 ||
        archiveEntry.uncompressedSize / archiveEntry.compressedSize > 200
      ) {
        skipped += 1;
        continue;
      }
      if (expandedBytes + archiveEntry.uncompressedSize > MAX_ARCHIVE_EXPANDED_BYTES) {
        skipped += 1;
        continue;
      }
      expandedBytes += archiveEntry.uncompressedSize;
      entries.push({
        id: crypto.randomUUID(),
        archive: file,
        archiveEntry,
        filename: safePath.filename,
        folderPath: safePath.folderPath,
        contentType: contentTypeFor(safePath.filename),
        bytes: archiveEntry.uncompressedSize,
        archiveName: file.name,
        status: "queued",
        progress: 0,
      });
    }
    return { entries, skipped, failed, reader };
  } catch (error) {
    await reader.close();
    return {
      entries: [],
      skipped: 0,
      failed: [error instanceof Error ? `Archive could not be read: ${error.message}` : "Archive could not be read."],
    };
  }
}

async function requestJson<T extends JsonResponse>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<T>(response);
}

function uploadB2File(
  endpoint: string,
  file: File,
  contentType: string,
  onProgress: (bytesSent: number) => void,
  onXhr: (xhr: XMLHttpRequest | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", endpoint);
    xhr.setRequestHeader("Content-Type", contentType);
    onXhr(xhr);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(file.size, event.loaded));
      }
    };
    xhr.onerror = () => {
      onXhr(null);
      reject(new Error("Your connection took a little break. Try again."));
    };
    xhr.onabort = () => {
      onXhr(null);
      reject(new Error("This upload was cancelled."));
    };
    xhr.onload = () => {
      onXhr(null);
      let response: { error?: string };
      try {
        response = JSON.parse(xhr.responseText) as typeof response;
      } catch {
        reject(new Error("The upload server returned an unreadable response."));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(response.error ?? `Backblaze upload failed (HTTP ${xhr.status}).`));
        return;
      }
      resolve();
    };
    xhr.send(file);
  });
}

export function MediaUploader() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const archiveReaders = useRef(new Set<ZipReader<Blob>>());
  const extractedArchiveBytes = useRef(0);
  const extractedArchiveEntrySizes = useRef(new Map<string, number>());
  const activeRequests = useRef(new Map<string, XMLHttpRequest>());
  const cancelledIds = useRef(new Set<string>());
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [archiveReports, setArchiveReports] = useState<ArchiveReport[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => () => {
    for (const reader of archiveReaders.current) void reader.close();
  }, []);

  const queuedCount = entries.filter((entry) => entry.status === "queued").length;
  const uploadedCount = entries.filter((entry) => entry.status === "done").length;
  const failedCount = entries.filter((entry) => entry.status === "failed").length;

  async function addFiles(files: FileList | File[]) {
    const newEntries: UploadEntry[] = [];
    const newReports: ArchiveReport[] = [];
    for (const file of Array.from(files)) {
      if (/\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
        const scanned = await scanArchive(file);
        const archiveId = crypto.randomUUID();
        if (scanned.reader) archiveReaders.current.add(scanned.reader);
        newEntries.push(...scanned.entries.map((entry) => ({ ...entry, archiveId })));
        newReports.push({
          id: archiveId,
          filename: file.name,
          skipped: scanned.skipped,
          failed: scanned.failed,
          uploadFailures: {},
          uploaded: 0,
        });
        if (!scanned.entries.length && scanned.reader) {
          await scanned.reader.close();
          archiveReaders.current.delete(scanned.reader);
        }
        continue;
      }
      const error = validateFile(file);
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
      const folderPath = relativePath.split("/").slice(0, -1).filter(Boolean).join("/");
      newEntries.push({
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
        folderPath,
        status: error ? "failed" : "queued",
        progress: 0,
        error,
      });
    }
    if (newEntries.length > 0 || newReports.length > 0) {
      setNotice("");
      setEntries((current) => [...current, ...newEntries]);
      setArchiveReports((current) => [...current, ...newReports]);
    }
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.currentTarget.files) void addFiles(event.currentTarget.files);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  async function uploadOne(entry: UploadEntry): Promise<{ success: boolean; error?: string }> {
    let itemId = "";
    let sentBytes = 0;
    let file = entry.file;

    const updateProgress = (bytes: number) => {
      sentBytes = Math.max(sentBytes, bytes);
      const progress = Math.min(100, (sentBytes / entry.bytes) * 100);
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, status: "uploading", progress } : item,
        ),
      );
    };

    try {
      if (cancelledIds.current.has(entry.id)) throw new Error("This upload was cancelled.");
      if (!file && entry.archive && entry.archiveEntry) {
        const blobWriter = new BlobWriter(entry.contentType);
        const sink = blobWriter.writable.getWriter();
        let extractedBytes = 0;
        const boundedWriter = new WritableStream<Uint8Array>({
          async write(chunk) {
            extractedBytes += chunk.byteLength;
            if (extractedBytes > MAX_ARCHIVE_ENTRY_BYTES) {
              throw new Error("The extracted file exceeded the safe 100 MB limit.");
            }
            await sink.write(chunk);
          },
          close() {
            return sink.close();
          },
          abort(reason) {
            return sink.abort(reason);
          },
        });
        try {
          await entry.archiveEntry.getData(boundedWriter, {
            checkCrc32: true,
            strictness: "strict",
            checkOverlappingEntry: true,
          });
        } catch (error) {
          try {
            await sink.abort(error);
          } catch (abortError) {
            console.error("[zip-import] Failed to close the bounded archive writer", abortError);
          }
          throw error;
        } finally {
          sink.releaseLock();
        }
        const blob = await blobWriter.getData();
        if (blob.size !== entry.bytes || blob.size > MAX_ARCHIVE_ENTRY_BYTES) {
          throw new Error("The extracted file did not match the archive's declared size.");
        }
        const countedSize = extractedArchiveEntrySizes.current.get(entry.id);
        if (countedSize === undefined) {
          if (extractedArchiveBytes.current + blob.size > MAX_ARCHIVE_EXPANDED_BYTES) {
            throw new Error("The archive contents exceed the safe 1 GB expanded-size limit.");
          }
          extractedArchiveBytes.current += blob.size;
          extractedArchiveEntrySizes.current.set(entry.id, blob.size);
        } else if (countedSize !== blob.size) {
          throw new Error("The extracted file changed size between upload attempts.");
        }
        file = new File([blob], entry.filename, { type: entry.contentType });
      }
      if (cancelledIds.current.has(entry.id)) throw new Error("This upload was cancelled.");
      if (!file) throw new Error("The selected file is no longer available.");
      const params = await requestJson<UploadTarget>("/api/uploads/initiate", {
        filename: entry.filename,
        folderPath: entry.folderPath,
        contentType: entry.contentType,
        bytes: entry.bytes,
      });
      itemId = params.itemId;
      if (cancelledIds.current.has(entry.id)) throw new Error("This upload was cancelled.");
      await uploadB2File(
        params.uploadUrl,
        file,
        params.contentType,
        updateProgress,
        (xhr) => {
          if (xhr) activeRequests.current.set(entry.id, xhr);
          else activeRequests.current.delete(entry.id);
        },
      );
      if (cancelledIds.current.has(entry.id)) throw new Error("This upload was cancelled.");

      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, status: "saving", progress: 100 } : item,
        ),
      );
      await requestJson("/api/uploads/complete", { itemId });
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, status: "done", progress: 100 } : item,
        ),
      );
      return { success: true };
    } catch (error) {
      const cancelled = cancelledIds.current.delete(entry.id);
      const message = error instanceof Error
        ? error.message
        : "That memory didn't make it through. Try again.";
      if (itemId) {
        try {
          const failure = await requestJson<UploadFailureResponse>("/api/uploads/fail", { itemId });
          if (failure.cleanupPending) {
            setNotice("The failed upload was recorded, but storage cleanup is pending. Check your Backblaze B2 settings.");
          }
        } catch (recordError) {
          console.error("[upload] Failed to record upload failure", recordError);
          setNotice("We couldn't save the failed-upload status. Check your connection.");
        }
      }
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id
            ? { ...item, status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : message }
            : item,
        ),
      );
      return { success: false, error: cancelled ? "Upload cancelled." : message };
    } finally {
      activeRequests.current.delete(entry.id);
    }
  }

  async function startUploads(retryOnly = false) {
    const pending = entries.filter((entry) =>
      retryOnly
        ? entry.status === "failed" || entry.status === "cancelled"
        : entry.status === "queued",
    );
    if (pending.length === 0 || uploading) return;

    setNotice("");
    setUploading(true);
    let nextIndex = 0;
    const completed: Array<{ entry: UploadEntry; success: boolean; error?: string }> = [];
    const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
      while (nextIndex < pending.length) {
        const entry = pending[nextIndex];
        nextIndex += 1;
        setEntries((current) =>
          current.map((item) =>
            item.id === entry.id
              ? { ...item, status: "uploading", progress: 0, error: undefined }
              : item,
          ),
        );
        const result = await uploadOne(entry);
        completed.push({ entry, ...result });
      }
    });

    await Promise.all(workers);
    setArchiveReports((current) => current.map((report) => {
      const archiveEntries = completed.filter(({ entry }) => entry.archiveId === report.id);
      const uploaded = archiveEntries.filter(({ success }) => success).length;
      const failedItems = archiveEntries.filter(({ success }) => !success);
      const uploadFailures = { ...report.uploadFailures };
      for (const { entry } of archiveEntries.filter(({ success }) => success)) {
        delete uploadFailures[entry.id];
      }
      for (const { entry, error } of failedItems) {
        uploadFailures[entry.id] =
          `${entry.folderPath ? `${entry.folderPath}/` : ""}${entry.filename}: ${error ?? "upload failed"}`;
      }
      return {
        ...report,
        uploaded: report.uploaded + uploaded,
        uploadFailures,
      };
    }));
    setUploading(false);
    const hasSuccessfulUpload = completed.some(({ success }) => success);
    setNotice(hasSuccessfulUpload
      ? "Your memories are arriving..."
      : "Nothing was uploaded. Check the file messages and retry.");
    if (hasSuccessfulUpload) router.refresh();
  }

  function removeEntry(id: string) {
    if (!uploading) {
      const extractedSize = extractedArchiveEntrySizes.current.get(id);
      if (extractedSize !== undefined) {
        extractedArchiveBytes.current -= extractedSize;
        extractedArchiveEntrySizes.current.delete(id);
      }
      setEntries((current) => current.filter((entry) => entry.id !== id));
      setArchiveReports((current) => current.map((report) => {
        const uploadFailures = { ...report.uploadFailures };
        delete uploadFailures[id];
        return { ...report, uploadFailures };
      }));
    }
  }

  function cancelEntry(id: string) {
    cancelledIds.current.add(id);
    activeRequests.current.get(id)?.abort();
  }

  async function clearQueue() {
    if (uploading) return;
    for (const reader of archiveReaders.current) await reader.close();
    archiveReaders.current.clear();
    extractedArchiveBytes.current = 0;
    extractedArchiveEntrySizes.current.clear();
    setEntries([]);
    setArchiveReports([]);
  }

  const totalProgress = entries.length
    ? Math.round(entries.reduce((total, entry) => total + entry.progress, 0) / entries.length)
    : 0;

  return (
    <section aria-labelledby="upload-heading" className="upload-section">
      <div className="upload-heading-row">
        <div>
          <p className="eyebrow">Keep a little more</p>
          <h2 id="upload-heading">Add memories</h2>
        </div>
        {(entries.length > 0 || archiveReports.length > 0) && (
          <button
            className="text-button"
            disabled={uploading}
            onClick={() => void clearQueue()}
            type="button"
          >
            Clear list
          </button>
        )}
      </div>

      <div
        className={`upload-dropzone${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.heif,.mp4,.mov,.webm,.zip,image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,application/zip"
          className="visually-hidden"
          multiple
          onChange={handleFileChange}
          ref={fileInput}
          type="file"
        />
        <input
          accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.heif,.mp4,.mov,.webm"
          className="visually-hidden"
          multiple
          onChange={handleFileChange}
          ref={(node) => {
            folderInput.current = node;
            node?.setAttribute("webkitdirectory", "");
            node?.setAttribute("directory", "");
          }}
          type="file"
        />
        <div aria-hidden="true" className="upload-icon"><ImagePlus size={22} strokeWidth={1.5} /></div>
        <h3>Drop your photos &amp; videos here</h3>
        <p>or choose photos, videos, or a ZIP · up to 500 MB per file</p>
        <button
          className="outline-button"
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          Choose files
        </button>
        <button
          className="outline-button folder-upload-button"
          onClick={() => folderInput.current?.click()}
          type="button"
        >
          Choose folder
        </button>
        <span className="upload-formats">JPG · PNG · WEBP · GIF · AVIF · HEIC · MP4 · MOV · WEBM · ZIP</span>
      </div>

      {entries.length > 0 && (
        <div className="upload-queue">
          <div className="upload-queue-header">
            <div>
              <h3>Your upload queue</h3>
              <p>{uploadedCount} of {entries.length} added{failedCount ? ` · ${failedCount} need another try` : ""}</p>
            </div>
            {uploading && <span className="upload-spinner"><LoaderCircle size={16} /> {totalProgress}%</span>}
          </div>
          {uploading && (
            <div
              aria-label={`Upload progress ${totalProgress}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={totalProgress}
              className="upload-total-progress"
              role="progressbar"
            >
              <span style={{ width: `${totalProgress}%` }} />
            </div>
          )}
          <ul className="upload-file-list">
            {entries.map((entry) => {
              const isVideo = entry.contentType.startsWith("video/") ||
                /\.(mp4|mov|webm)$/i.test(entry.filename);
              return (
                <li className="upload-file-row" key={entry.id}>
                  <span className="upload-file-icon">
                    {isVideo ? <FileVideo2 size={17} /> : <ImagePlus size={17} />}
                  </span>
                  <div className="upload-file-info">
                    <span className="upload-file-name">
                      {entry.archiveName && <span>{entry.archiveName} · </span>}
                      {entry.folderPath && <span>{entry.folderPath}/</span>}
                      {entry.filename}
                    </span>
                    <span className="upload-file-meta">
                      {formatBytes(entry.bytes)}
                      {entry.status === "uploading" && ` · ${Math.round(entry.progress)}%`}
                      {entry.status === "saving" && " · saving securely"}
                      {entry.status === "done" && " · added"}
                      {entry.status === "queued" && " · ready"}
                      {entry.status === "cancelled" && " · cancelled"}
                      {entry.status === "failed" && ` · ${entry.error ?? "needs a retry"}`}
                    </span>
                  </div>
                  {entry.status === "done" ? (
                    <Check aria-label="Uploaded" className="upload-success" size={17} />
                  ) : entry.status === "uploading" || entry.status === "saving" ? (
                    entry.status === "uploading" ? (
                      <button
                        aria-label={`Cancel ${entry.filename}`}
                        className="upload-remove"
                        onClick={() => cancelEntry(entry.id)}
                        type="button"
                      ><X size={16} /></button>
                    ) : (
                    <LoaderCircle aria-label="Uploading" className="upload-row-spinner" size={17} />
                    )
                  ) : (
                    <button
                      aria-label={`Remove ${entry.filename}`}
                      className="upload-remove"
                      disabled={uploading}
                      onClick={() => removeEntry(entry.id)}
                      type="button"
                    >
                      <X size={16} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {notice && <p className="upload-notice" role="status">{notice}</p>}
          {archiveReports.map((report) => (
            <div className="archive-report" key={report.id} role="status">
              <strong>{report.filename}</strong>
              <span>{report.uploaded} uploaded · {report.failed.length + Object.keys(report.uploadFailures).length} failed · {report.skipped} skipped</span>
              {(report.failed.length > 0 || Object.keys(report.uploadFailures).length > 0) && (
                <details>
                  <summary>Show failed entries</summary>
                  <ul>
                    {report.failed.map((message, index) => <li key={`${report.id}-scan-${index}`}>{message}</li>)}
                    {Object.entries(report.uploadFailures).map(([id, message]) => <li key={id}>{message}</li>)}
                  </ul>
                </details>
              )}
            </div>
          ))}
          <div className="upload-actions">
            {queuedCount > 0 && (
              <button
                className="primary-button upload-start"
                disabled={uploading}
                onClick={() => void startUploads()}
                type="button"
              >
                {uploading ? "Uploading..." : `Upload ${queuedCount} ${queuedCount === 1 ? "file" : "files"}`}
                {!uploading && <ArrowUpFromLine size={15} />}
              </button>
            )}
            {!uploading && entries.some((entry) => entry.status === "failed" || entry.status === "cancelled") && (
              <button
                className="outline-button"
                onClick={() => void startUploads(true)}
                type="button"
              >
                <RotateCcw size={14} /> Retry failed
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

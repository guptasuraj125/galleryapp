import { createHash } from "node:crypto";
import { connectToDatabase } from "@/src/lib/mongodb";
import { RateLimit } from "@/src/models/RateLimit";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export async function consumeRateLimit(
  key: string,
  maximum: number,
  windowMilliseconds: number,
): Promise<RateLimitResult> {
  await connectToDatabase();

  const now = Date.now();
  const windowId = Math.floor(now / windowMilliseconds);
  const expiresAt = new Date((windowId + 1) * windowMilliseconds);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const bucketId = `${windowId}:${keyHash}`;

  let bucket;
  try {
    bucket = await RateLimit.findOneAndUpdate(
      { _id: bucketId },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    bucket = await RateLimit.findByIdAndUpdate(bucketId, { $inc: { count: 1 } }, { new: true }).lean();
    if (!bucket) {
      throw error;
    }
  }

  return {
    allowed: bucket.count <= maximum,
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)),
  };
}

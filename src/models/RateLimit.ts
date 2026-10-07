import { model, models, Schema } from "mongoose";

export interface RateLimitRecord {
  _id: string;
  count: number;
  expiresAt: Date;
}

const rateLimitSchema = new Schema<RateLimitRecord>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, min: 1 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = models.RateLimit ?? model<RateLimitRecord>("RateLimit", rateLimitSchema);

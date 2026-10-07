import { model, models, Schema, Types } from "mongoose";

export interface UploadJobRecord {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  userId: Types.ObjectId;
  status: "pending" | "uploading" | "processing" | "completed" | "failed" | "cancelled";
  totalItems: number;
  completedItems: number;
  idempotencyKey?: string;
}

const uploadJobSchema = new Schema<UploadJobRecord>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: "PrivateSpace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "uploading", "processing", "completed", "failed", "cancelled"],
      default: "pending",
      required: true,
    },
    totalItems: { type: Number, required: true, min: 0 },
    completedItems: { type: Number, default: 0, min: 0, required: true },
    idempotencyKey: { type: String, trim: true, maxlength: 128 },
  },
  { timestamps: true },
);

uploadJobSchema.index({ spaceId: 1, createdAt: -1 });
uploadJobSchema.index({ userId: 1, createdAt: -1 });
uploadJobSchema.index({ userId: 1, idempotencyKey: 1 }, { sparse: true, unique: true });

export const UploadJob = models.UploadJob ?? model<UploadJobRecord>("UploadJob", uploadJobSchema);

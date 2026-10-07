import { model, models, Schema, Types } from "mongoose";

export interface UploadItemRecord {
  _id: Types.ObjectId;
  uploadJobId: Types.ObjectId;
  mediaAssetId?: Types.ObjectId;
  publicId: string;
  provider: "cloudinary" | "backblaze";
  resourceType: "image" | "video";
  contentType: string;
  originalFilename: string;
  expectedBytes: number;
  status: "pending" | "uploading" | "processing" | "completed" | "failed";
  errorMessage?: string;
  folderPath?: string;
}

const uploadItemSchema = new Schema<UploadItemRecord>(
  {
    uploadJobId: { type: Schema.Types.ObjectId, ref: "UploadJob", required: true },
    mediaAssetId: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    publicId: { type: String, required: true, trim: true, maxlength: 255 },
    provider: { type: String, enum: ["cloudinary", "backblaze"], default: "cloudinary", required: true },
    resourceType: { type: String, enum: ["image", "video"], required: true },
    contentType: { type: String, required: true, trim: true, maxlength: 127 },
    originalFilename: { type: String, required: true, trim: true, maxlength: 255 },
    expectedBytes: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "uploading", "processing", "completed", "failed"],
      default: "pending",
      required: true,
    },
    errorMessage: { type: String, trim: true, maxlength: 500 },
    folderPath: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

uploadItemSchema.index({ uploadJobId: 1, createdAt: 1 });
uploadItemSchema.index({ mediaAssetId: 1 }, { sparse: true });
uploadItemSchema.index({ publicId: 1 }, { unique: true });

export const UploadItem =
  models.UploadItem ?? model<UploadItemRecord>("UploadItem", uploadItemSchema);

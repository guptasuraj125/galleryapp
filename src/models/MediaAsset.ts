import { model, models, Schema, Types } from "mongoose";

export interface MediaAssetRecord {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  memoryId?: Types.ObjectId;
  provider: "cloudinary" | "backblaze";
  storageKey?: string;
  publicId: string;
  resourceType: "image" | "video";
  format: string;
  version?: number;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  originalFilename: string;
  contentType: string;
  status: "processing" | "ready" | "failed" | "deleted";
  folderPath?: string;
  isFavorite: boolean;
}

const mediaAssetSchema = new Schema<MediaAssetRecord>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: "PrivateSpace", required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    memoryId: { type: Schema.Types.ObjectId, ref: "Memory" },
    provider: { type: String, enum: ["cloudinary", "backblaze"], default: "cloudinary", required: true },
    publicId: { type: String, required: true, trim: true, maxlength: 255 },
    storageKey: { type: String, trim: true, maxlength: 1024 },
    resourceType: { type: String, enum: ["image", "video"], required: true },
    format: { type: String, required: true, lowercase: true, maxlength: 16 },
    version: { type: Number, min: 1 },
    bytes: { type: Number, required: true, min: 0 },
    width: { type: Number, min: 1 },
    height: { type: Number, min: 1 },
    duration: { type: Number, min: 0 },
    originalFilename: { type: String, required: true, trim: true, maxlength: 255 },
    contentType: { type: String, required: true, trim: true, maxlength: 127 },
    folderPath: { type: String, trim: true, maxlength: 500 },
    isFavorite: { type: Boolean, default: false, required: true },
    status: {
      type: String,
      enum: ["processing", "ready", "failed", "deleted"],
      default: "processing",
      required: true,
    },
  },
  { timestamps: true },
);

mediaAssetSchema.index({ spaceId: 1, createdAt: -1 });
mediaAssetSchema.index({ spaceId: 1, publicId: 1 }, { unique: true });
mediaAssetSchema.index({ memoryId: 1 });
mediaAssetSchema.index({ spaceId: 1, resourceType: 1, status: 1, createdAt: -1 });

export const MediaAsset =
  models.MediaAsset ?? model<MediaAssetRecord>("MediaAsset", mediaAssetSchema);

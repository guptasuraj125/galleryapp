import { model, models, Schema, Types } from "mongoose";

export interface MemoryRecord {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  createdBy: Types.ObjectId;
  title: string;
  caption?: string;
  note?: string;
  occurredAt: Date;
  locationId?: Types.ObjectId;
  mediaAssetIds: Types.ObjectId[];
  tagIds: Types.ObjectId[];
  isFavorite: boolean;
}

const memorySchema = new Schema<MemoryRecord>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: "PrivateSpace", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    caption: { type: String, trim: true, maxlength: 5000 },
    note: { type: String, trim: true, maxlength: 10000 },
    occurredAt: { type: Date, required: true },
    locationId: { type: Schema.Types.ObjectId, ref: "Location" },
    mediaAssetIds: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    tagIds: [{ type: Schema.Types.ObjectId, ref: "Tag" }],
    isFavorite: { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
);

memorySchema.index({ spaceId:  1, occurredAt: -1 });
memorySchema.index({ spaceId: 1, createdAt: -1 });
memorySchema.index({ spaceId: 1, isFavorite: 1, occurredAt: -1 });

export const Memory = models.Memory ?? model<MemoryRecord>("Memory", memorySchema);

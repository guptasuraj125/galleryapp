import { model, models, Schema, Types } from "mongoose";

export interface TagRecord {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  name: string;
  color?: string;
}

const tagSchema = new Schema<TagRecord>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: "PrivateSpace", required: true },
    name: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
  },
  { timestamps: true },
);

tagSchema.index({ spaceId: 1, name: 1 }, { unique: true });

export const Tag = models.Tag ?? model<TagRecord>("Tag", tagSchema);

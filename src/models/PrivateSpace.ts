import { model, models, Schema, Types } from "mongoose";

export interface PrivateSpaceRecord {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  createdBy: Types.ObjectId;
  description?: string;
}

const privateSpaceSchema = new Schema<PrivateSpaceRecord>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    description: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

privateSpaceSchema.index({ slug: 1 }, { unique: true });
privateSpaceSchema.index({ createdBy: 1 });

export const PrivateSpace =
  models.PrivateSpace ?? model<PrivateSpaceRecord>("PrivateSpace", privateSpaceSchema);

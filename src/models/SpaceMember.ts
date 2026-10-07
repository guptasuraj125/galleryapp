import { model, models, Schema, Types } from "mongoose";

export interface SpaceMemberRecord {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: "owner" | "member";
  joinedAt: Date;
}

const spaceMemberSchema = new Schema<SpaceMemberRecord>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: "PrivateSpace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "member"], default: "member", required: true },
    joinedAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true },
);

spaceMemberSchema.index({ spaceId: 1, userId: 1 }, { unique: true });
spaceMemberSchema.index({ userId: 1 });

export const SpaceMember =
  models.SpaceMember ?? model<SpaceMemberRecord>("SpaceMember", spaceMemberSchema);

import { model, models, Schema, Types } from "mongoose";

export interface InvitationRecord {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  invitedBy: Types.ObjectId;
  email: string;
  tokenHash: string;
  role: "member";
  expiresAt: Date;
  acceptedAt?: Date;
}

const invitationSchema = new Schema<InvitationRecord>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: "PrivateSpace", required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    tokenHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["member"], default: "member", required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true },
);

invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ spaceId: 1, email: 1, acceptedAt: 1 });
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Invitation = models.Invitation ?? model<InvitationRecord>("Invitation", invitationSchema);

import { model, models, Schema, Types } from "mongoose";

export interface UserRecord {
  _id: Types.ObjectId;
  email: string;
  username: string;
  displayName: string;
  passwordHash: string;
  isActive: boolean;
}

const userSchema = new Schema<UserRecord>(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    username: { type: String, required: true, trim: true, lowercase: true, maxlength: 32 },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

export const User = models.User ?? model<UserRecord>("User", userSchema);

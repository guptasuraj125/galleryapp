import { model, models, Schema, Types } from "mongoose";

export interface LocationRecord {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
}

const locationSchema = new Schema<LocationRecord>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: "PrivateSpace", required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 500 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    placeId: { type: String, trim: true, maxlength: 255 },
  },
  { timestamps: true },
);

locationSchema.index({ spaceId: 1, name: 1 });
locationSchema.index({ spaceId: 1, placeId: 1 }, { sparse: true });
locationSchema.index({ spaceId: 1, latitude: 1, longitude: 1 });

export const Location = models.Location ?? model<LocationRecord>("Location", locationSchema);

import { Types } from "mongoose";
import { Memory } from "@/src/models/Memory";

/** Remove an auto-created upload memory only when its last asset was deleted. */
export async function removeEmptyUploadMemories(
  spaceId: Types.ObjectId,
  deletedAssets: Array<{ memoryId?: Types.ObjectId; originalFilename: string }>,
) {
  const candidates = deletedAssets.flatMap((asset) => {
    if (!asset.memoryId) return [];
    return [{
      memoryId: asset.memoryId,
      title: asset.originalFilename.replace(/\.[^.]+$/, "").slice(0, 160),
    }];
  });

  await Promise.all(candidates.map(({ memoryId, title }) => Memory.deleteOne({
    _id: memoryId,
    spaceId,
    title,
    caption: { $in: ["", null] },
    note: { $in: ["", null] },
    mediaAssetIds: { $size: 0 },
    tagIds: { $size: 0 },
    locationId: { $exists: false },
    isFavorite: false,
  })));
}

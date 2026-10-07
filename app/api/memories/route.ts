import { Types } from "mongoose";
import { z } from "zod";
import { createB2DownloadUrl } from "@/src/lib/backblaze";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import {
  getAuthenticatedAssetVersion,
  getAuthenticatedDeliveryUrls,
  listAuthenticatedAssetPublicIds,
} from "@/src/lib/cloudinary";
import { connectToDatabase } from "@/src/lib/mongodb";
import { Location } from "@/src/models/Location";
import { MediaAsset } from "@/src/models/MediaAsset";
import { Memory, type MemoryRecord } from "@/src/models/Memory";
import { Tag } from "@/src/models/Tag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function removeMissingCloudinaryAssets(spaceId: Types.ObjectId) {
  const storedAssets = await MediaAsset.find({ spaceId, provider: "cloudinary", status: "ready" })
    .select("_id publicId resourceType memoryId originalFilename")
    .lean();
  if (storedAssets.length === 0) return;

  const prefix = `ghumi/${String(spaceId)}/`;
  const [imageIds, videoIds] = await Promise.all([
    listAuthenticatedAssetPublicIds(prefix, "image"),
    listAuthenticatedAssetPublicIds(prefix, "video"),
  ]);
  const staleAssets = storedAssets.filter((asset) =>
    !(asset.resourceType === "image" ? imageIds : videoIds).has(asset.publicId),
  );
  if (staleAssets.length === 0) return;

  const staleIds = staleAssets.map((asset) => asset._id);
  await MediaAsset.deleteMany({ _id: { $in: staleIds }, spaceId });
  const memoryIds = [...new Set(staleAssets.flatMap((asset) => asset.memoryId ? [String(asset.memoryId)] : []))]
    .map((id) => new Types.ObjectId(id));
  if (memoryIds.length === 0) return;

  await Memory.updateMany(
    { spaceId, mediaAssetIds: { $in: staleIds } },
    { $pull: { mediaAssetIds: { $in: staleIds } } },
  );

  const generatedTitles = [...new Set(staleAssets.map((asset) =>
    asset.originalFilename.replace(/\.[^.]+$/, "").slice(0, 160),
  ))];
  await Memory.deleteMany({
    _id: { $in: memoryIds },
    spaceId,
    title: { $in: generatedTitles },
    caption: { $in: ["", null] },
    note: { $in: ["", null] },
    mediaAssetIds: { $size: 0 },
    tagIds: { $size: 0 },
    locationId: { $exists: false },
    isFavorite: false,
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  caption: z.string().trim().max(5000).optional().default(""),
  note: z.string().trim().max(10000).optional().default(""),
  occurredAt: z.coerce.date(),
  mediaAssetIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100).default([]),
  locationName: z.string().trim().max(160).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
  try {
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to view your memories.", 401);
    await connectToDatabase();
    try {
      await removeMissingCloudinaryAssets(auth.membership.spaceId);
    } catch (syncError) {
      logApiError("cloudinary-gallery-sync", syncError);
    }

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 48));
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    const galleryMode = url.searchParams.get("gallery") === "true";
    const conditions: Record<string, unknown>[] = [{ spaceId: auth.membership.spaceId }];
    const query = url.searchParams.get("q")?.trim().slice(0, 100);
    if (query) {
      const regex = new RegExp(escapeRegex(query), "i");
      const [matchingLocations, matchingTags] = await Promise.all([
        Location.find({ spaceId: auth.membership.spaceId, name: regex }).select("_id").lean(),
        Tag.find({ spaceId: auth.membership.spaceId, name: regex }).select("_id").lean(),
      ]);
      conditions.push({
        $or: [
          { title: regex },
          { caption: regex },
          { note: regex },
          { locationId: { $in: matchingLocations.map((item) => item._id) } },
          { tagIds: { $in: matchingTags.map((item) => item._id) } },
        ],
      });
    }

    const type = url.searchParams.get("type");
    if (!galleryMode && (type === "image" || type === "video")) {
      const assets = await MediaAsset.find({
        spaceId: auth.membership.spaceId,
        resourceType: type,
        status: "ready",
      }).select("_id").lean();
      conditions.push({ mediaAssetIds: { $in: assets.map((item) => item._id) } });
    }

    if (url.searchParams.get("favorite") === "true") {
      conditions.push({ isFavorite: true });
    }
    if (url.searchParams.has("monthDay")) {
      const date = new Date();
      const month = date.getMonth();
      const day = date.getDate();
      conditions.push({
        $expr: {
          $and: [
            { $eq: [{ $month: "$occurredAt" }, month + 1] },
            { $eq: [{ $dayOfMonth: "$occurredAt" }, day] },
            { $lt: [{ $year: "$occurredAt" }, date.getFullYear()] },
          ],
        },
      });
    }

    const filter = conditions.length === 1 ? conditions[0] : { $and: conditions };
    const surprise = url.searchParams.get("surprise") === "true";
    let memories: MemoryRecord[];
    let total: number;
    let totalPages: number;
    if (galleryMode) {
      const assetBaseFilter = { spaceId: auth.membership.spaceId, status: "ready" };
      const counts = await MediaAsset.aggregate<{ _id: "image" | "video"; count: number }>([
        { $match: assetBaseFilter },
        { $group: { _id: "$resourceType", count: { $sum: 1 } } },
      ]);
      const imageCount = counts.find((entry) => entry._id === "image")?.count ?? 0;
      const videoCount = counts.find((entry) => entry._id === "video")?.count ?? 0;
      const totalCount = imageCount + videoCount;
      const selectedType = type === "image" || type === "video" ? type : null;
      const selectedTypeCount = selectedType === "image" ? imageCount : selectedType === "video" ? videoCount : totalCount;
      const hasBothTypes = !selectedType && imageCount > 0 && videoCount > 0;
      const perTypeLimit = hasBothTypes ? Math.floor(limit / 2) : limit;
      const pageAssetFilter = (resourceType: "image" | "video") => ({ ...assetBaseFilter, resourceType });
      let pageAssets;
      if (selectedType) {
        pageAssets = await MediaAsset.find(pageAssetFilter(selectedType))
          .sort({ createdAt: -1, _id: -1 }).skip(page * limit).limit(limit)
          .select("_id memoryId createdAt").lean();
      } else if (hasBothTypes) {
        const [images, videos] = await Promise.all([
          MediaAsset.find(pageAssetFilter("image")).sort({ createdAt: -1, _id: -1 }).skip(page * perTypeLimit).limit(perTypeLimit).select("_id memoryId createdAt").lean(),
          MediaAsset.find(pageAssetFilter("video")).sort({ createdAt: -1, _id: -1 }).skip(page * perTypeLimit).limit(perTypeLimit).select("_id memoryId createdAt").lean(),
        ]);
        pageAssets = [...images, ...videos].sort((a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || String(b._id).localeCompare(String(a._id)),
        );
      } else {
        const onlyType = imageCount > 0 ? "image" : "video";
        pageAssets = await MediaAsset.find(pageAssetFilter(onlyType))
          .sort({ createdAt: -1, _id: -1 }).skip(page * limit).limit(limit)
          .select("_id memoryId createdAt").lean();
      }
      total = selectedTypeCount;
      totalPages = selectedType
        ? Math.ceil(selectedTypeCount / limit)
        : hasBothTypes
          ? Math.max(Math.ceil(imageCount / perTypeLimit), Math.ceil(videoCount / perTypeLimit))
          : Math.ceil(totalCount / limit);
      const pageAssetIds = pageAssets.map((asset) => asset._id);
      const linkedMemoryIds = pageAssets.flatMap((asset) => asset.memoryId ? [asset.memoryId] : []);
      const legacyAssetIds = pageAssets.flatMap((asset) => asset.memoryId ? [] : [asset._id]);
      const memoryConditions = [
        ...(linkedMemoryIds.length ? [{ _id: { $in: linkedMemoryIds } }] : []),
        ...(legacyAssetIds.length ? [{ mediaAssetIds: { $in: legacyAssetIds } }] : []),
      ];
      const linkedMemories = memoryConditions.length
        ? await Memory.find({
          spaceId: auth.membership.spaceId,
          $or: memoryConditions,
        }).sort({ occurredAt: -1, _id: -1 }).lean()
        : [];
      const pageAssetIdSet = new Set(pageAssetIds.map(String));
      const memoryByAssetId = new Map<string, MemoryRecord>();
      for (const memory of linkedMemories) {
        for (const assetId of memory.mediaAssetIds) {
          const id = String(assetId);
          if (pageAssetIdSet.has(id) && !memoryByAssetId.has(id)) {
            memoryByAssetId.set(id, memory);
          }
        }
      }
      memories = pageAssets.flatMap((asset) => {
        const memory = memoryByAssetId.get(String(asset._id));
        return memory ? [{ ...memory, mediaAssetIds: [asset._id] }] : [];
      });
    } else if (surprise) {
      total = await Memory.countDocuments(filter);
      totalPages = Math.ceil(total / limit);
      const randomOffset = total ? Math.floor(Math.random() * total) : 0;
      memories = total
        ? await Memory.find(filter).skip(randomOffset).limit(1).lean()
        : [];
    } else {
      [memories, total] = await Promise.all([
        Memory.find(filter).sort({ occurredAt: -1, _id: -1 }).skip(page * limit).limit(limit).lean(),
        Memory.countDocuments(filter),
      ]);
      totalPages = Math.ceil(total / limit);
    }
    const mediaIds = [...new Set(memories.flatMap((memory) => memory.mediaAssetIds.map(String)))];
    const locationIds = [...new Set(memories.flatMap((memory) => memory.locationId ? [String(memory.locationId)] : []))]
      .map((id) => new Types.ObjectId(id));
    const tagIds = [...new Set(memories.flatMap((memory) => memory.tagIds.map(String)))]
      .map((id) => new Types.ObjectId(id));
    const [assets, locations, tags] = await Promise.all([
      MediaAsset.find({
        _id: { $in: mediaIds },
        spaceId: auth.membership.spaceId,
        status: "ready",
      }).lean(),
      locationIds.length ? Location.find({ _id: { $in: locationIds }, spaceId: auth.membership.spaceId }).lean() : [],
      tagIds.length ? Tag.find({ _id: { $in: tagIds }, spaceId: auth.membership.spaceId }).lean() : [],
    ]);
    const versionByAssetId = new Map<string, number>();
    const assetsNeedingVersion = assets.filter((asset) => asset.provider !== "backblaze" && !asset.version);
    for (let start = 0; start < assetsNeedingVersion.length; start += 6) {
      await Promise.all(assetsNeedingVersion.slice(start, start + 6).map(async (asset) => {
        try {
          const version = await getAuthenticatedAssetVersion(asset.publicId, asset.resourceType);
          versionByAssetId.set(String(asset._id), version);
          await MediaAsset.updateOne({ _id: asset._id, version: { $exists: false } }, { $set: { version } });
        } catch {
          // Keep the memory visible if Cloudinary's metadata API is temporarily unavailable.
        }
      }));
    }
    const locationById = new Map(locations.map((location) => [String(location._id), location]));
    const tagById = new Map(tags.map((tag) => [String(tag._id), tag]));
    const assetById = new Map(assets.map((asset) => [String(asset._id), asset]));
    const deliveryByAssetId = new Map<string, { url: string; posterUrl?: string }>();
    await Promise.all(assets.map(async (asset) => {
      if (asset.provider === "backblaze") {
        deliveryByAssetId.set(String(asset._id), {
          url: await createB2DownloadUrl(asset.storageKey ?? asset.publicId, asset.contentType, asset.originalFilename),
        });
      } else {
        const delivery = getAuthenticatedDeliveryUrls(
          asset.publicId,
          asset.resourceType,
          asset.format,
          asset.version ?? versionByAssetId.get(String(asset._id)),
        );
        deliveryByAssetId.set(String(asset._id), { url: delivery.assetUrl, posterUrl: delivery.posterUrl });
      }
    }));

    const items = memories.map((memory) => ({
      id: String(memory._id),
      title: memory.title,
      caption: memory.caption ?? "",
      note: memory.note ?? "",
      occurredAt: memory.occurredAt,
      isFavorite: memory.isFavorite,
      location: memory.locationId ? locationById.get(String(memory.locationId)) ?? null : null,
      tags: memory.tagIds.map((id) => tagById.get(String(id))).filter(Boolean),
      media: memory.mediaAssetIds.flatMap((id) => {
        const asset = assetById.get(String(id));
        if (!asset) return [];
        const delivery = deliveryByAssetId.get(String(asset._id));
        if (!delivery) return [];
        return [{
          id: String(asset._id),
          resourceType: asset.resourceType,
          format: asset.format,
          bytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          duration: asset.duration,
          originalFilename: asset.originalFilename,
          folderPath: asset.folderPath ?? "",
          url: delivery.url,
          ...(delivery?.posterUrl ? { posterUrl: delivery.posterUrl } : {}),
        }];
      }),
    }));
    return successJson({ items, page, limit, total, totalPages, hasMore: page + 1 < totalPages });
  } catch (error) {
    logApiError("memories-list", error);
    return errorJson("Your memories could not be loaded right now.", 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to create a memory.", 401);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return errorJson("Check the memory details and try again.", 400);
    await connectToDatabase();

    const mediaIds = parsed.data.mediaAssetIds.map((id) => new Types.ObjectId(id));
    const [assets, location] = await Promise.all([
      MediaAsset.find({
        _id: { $in: mediaIds },
        spaceId: auth.membership.spaceId,
        status: "ready",
      }).select("_id").lean(),
      parsed.data.locationName
        ? Location.findOneAndUpdate(
            { spaceId: auth.membership.spaceId, name: parsed.data.locationName },
            {
              $set: {
                ...(parsed.data.latitude !== undefined ? { latitude: parsed.data.latitude } : {}),
                ...(parsed.data.longitude !== undefined ? { longitude: parsed.data.longitude } : {}),
              },
              $setOnInsert: { spaceId: auth.membership.spaceId, name: parsed.data.locationName },
            },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
          )
        : Promise.resolve(null),
    ]);
    if (assets.length !== mediaIds.length) return errorJson("One or more selected files are unavailable.", 400);

    const names = [...new Set(parsed.data.tags.map((name) => name.toLowerCase()))];
    const tagIds = await Promise.all(names.map(async (name) => {
      const tag = await Tag.findOneAndUpdate(
        { spaceId: auth.membership.spaceId, name },
        { $setOnInsert: { spaceId: auth.membership.spaceId, name } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
      return tag._id;
    }));
    const [memory] = await Memory.create([{
      spaceId: auth.membership.spaceId,
      createdBy: auth.user._id,
      title: parsed.data.title,
      caption: parsed.data.caption,
      note: parsed.data.note,
      occurredAt: parsed.data.occurredAt,
      locationId: location?._id,
      mediaAssetIds: mediaIds,
      tagIds,
      isFavorite: false,
    }]);
    if (mediaIds.length) {
      await MediaAsset.updateMany({ _id: { $in: mediaIds } }, { $set: { memoryId: memory._id } });
    }
    return successJson({ id: String(memory._id) }, 201);
  } catch (error) {
    logApiError("memory-create", error);
    return errorJson("Your memory could not be saved right now.", 500);
  }
}

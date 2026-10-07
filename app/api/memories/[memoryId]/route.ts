import { Types } from "mongoose";
import { z } from "zod";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import { connectToDatabase } from "@/src/lib/mongodb";
import { Location } from "@/src/models/Location";
import { MediaAsset } from "@/src/models/MediaAsset";
import { Memory } from "@/src/models/Memory";
import { Tag } from "@/src/models/Tag";

export const runtime = "nodejs";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  caption: z.string().trim().max(5000).optional(),
  note: z.string().trim().max(10000).optional(),
  occurredAt: z.coerce.date().optional(),
  isFavorite: z.boolean().optional(),
  locationName: z.string().trim().max(160).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  mediaAssetIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100).optional(),
});

type RouteContext = { params: Promise<{ memoryId: string }> };

async function findAuthorizedMemory(request: Request, params: RouteContext["params"]) {
  const auth = await getUserSpaceMembership();
  if (!auth) return { response: errorJson("Sign in to manage your memories.", 401) } as const;
  const { memoryId } = await params;
  if (!/^[a-f\d]{24}$/i.test(memoryId)) {
    return { response: errorJson("This memory could not be found.", 404) } as const;
  }
  await connectToDatabase();
  const memory = await Memory.findOne({
    _id: new Types.ObjectId(memoryId),
    spaceId: auth.membership.spaceId,
  });
  if (!memory) return { response: errorJson("This memory could not be found.", 404) } as const;
  if (
    auth.membership.role !== "owner" &&
    String(memory.createdBy) !== String(auth.user._id)
  ) {
    return { response: errorJson("You don't have permission to edit this memory.", 403) } as const;
  }
  return { auth, memory } as const;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const result = await findAuthorizedMemory(request, context.params);
    if ("response" in result) return result.response;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return errorJson("Check the memory details and try again.", 400);
    const { auth, memory } = result;
    const updates = parsed.data;

    if (updates.title !== undefined) memory.title = updates.title;
    if (updates.caption !== undefined) memory.caption = updates.caption;
    if (updates.note !== undefined) memory.note = updates.note;
    if (updates.occurredAt !== undefined) memory.occurredAt = updates.occurredAt;
    if (updates.isFavorite !== undefined) memory.isFavorite = updates.isFavorite;

    if (updates.locationName !== undefined) {
      if (updates.locationName === null || !updates.locationName) {
        memory.locationId = undefined;
      } else {
        const location = await Location.findOneAndUpdate(
          { spaceId: auth.membership.spaceId, name: updates.locationName },
          {
            $set: {
              ...(updates.latitude != null ? { latitude: updates.latitude } : {}),
              ...(updates.longitude != null ? { longitude: updates.longitude } : {}),
            },
            $setOnInsert: { spaceId: auth.membership.spaceId, name: updates.locationName },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        );
        memory.locationId = location._id;
      }
    }

    if (updates.tags !== undefined) {
      const names = [...new Set(updates.tags.map((tag) => tag.toLowerCase()))];
      const tags = await Promise.all(names.map((name) => Tag.findOneAndUpdate(
        { spaceId: auth.membership.spaceId, name },
        { $setOnInsert: { spaceId: auth.membership.spaceId, name } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      )));
      memory.tagIds = tags.map((tag) => tag._id);
    }

    if (updates.mediaAssetIds !== undefined) {
      const nextIds = updates.mediaAssetIds.map((id) => new Types.ObjectId(id));
      const assets = await MediaAsset.find({
        _id: { $in: nextIds },
        spaceId: auth.membership.spaceId,
        status: "ready",
      }).select("_id").lean();
      if (assets.length !== nextIds.length) return errorJson("One or more selected files are unavailable.", 400);
      await MediaAsset.updateMany(
        { memoryId: memory._id, spaceId: auth.membership.spaceId },
        { $unset: { memoryId: 1 } },
      );
      await MediaAsset.updateMany(
        { _id: { $in: nextIds }, spaceId: auth.membership.spaceId },
        { $set: { memoryId: memory._id } },
      );
      memory.mediaAssetIds = nextIds;
    }

    await memory.save();
    return successJson({ updated: true });
  } catch (error) {
    logApiError("memory-update", error);
    return errorJson("Your memory could not be updated right now.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const result = await findAuthorizedMemory(request, context.params);
    if ("response" in result) return result.response;
    const { auth, memory } = result;
    await MediaAsset.updateMany(
      { memoryId: memory._id, spaceId: auth.membership.spaceId },
      { $unset: { memoryId: 1 } },
    );
    await memory.deleteOne();
    return successJson({ deleted: true });
  } catch (error) {
    logApiError("memory-delete", error);
    return errorJson("Your memory could not be deleted right now.", 500);
  }
}

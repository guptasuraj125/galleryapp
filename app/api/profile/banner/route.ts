import { Types } from "mongoose";
import { z } from "zod";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import { connectToDatabase } from "@/src/lib/mongodb";
import { MediaAsset } from "@/src/models/MediaAsset";
import { PrivateSpace } from "@/src/models/PrivateSpace";
import { getUserSpaceMembership } from "@/src/lib/auth";

const bannerSchema = z.object({
  mediaAssetId: z.string().regex(/^[a-f\d]{24}$/i).nullable(),
});

export async function PATCH(request: Request) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to update the profile banner.", 401);
    if (auth.membership.role !== "owner") return errorJson("Only the space owner can update the profile banner.", 403);

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) return errorJson("Choose a valid banner video.", 400);
      throw error;
    }
    const parsed = bannerSchema.safeParse(body);
    if (!parsed.success) return errorJson("Choose a valid video from this space.", 400);

    await connectToDatabase();
    const space = await PrivateSpace.findById(auth.membership.spaceId);
    if (!space) return errorJson("Your private space could not be found.", 404);

    if (parsed.data.mediaAssetId === null) {
      space.profileBannerMediaAssetId = undefined;
      await space.save();
      return successJson({ updated: true, profileBanner: null });
    }

    const mediaAssetId = new Types.ObjectId(parsed.data.mediaAssetId);
    const asset = await MediaAsset.findOne({
      _id: mediaAssetId,
      spaceId: auth.membership.spaceId,
      resourceType: "video",
      status: "ready",
    }).select("_id");
    if (!asset) return errorJson("Choose a ready video from this private space.", 404);

    space.profileBannerMediaAssetId = asset._id;
    await space.save();
    return successJson({ updated: true });
  } catch (error) {
    logApiError("profile-banner-update", error);
    return errorJson("The profile banner could not be updated right now.", 500);
  }
}

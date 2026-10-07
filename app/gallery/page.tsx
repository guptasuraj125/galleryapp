import type { Metadata } from "next";
import { MemoryBrowser } from "@/src/components/memory-browser";
import { requireUser } from "@/src/lib/auth";
import { connectToDatabase } from "@/src/lib/mongodb";
import { MediaAsset } from "@/src/models/MediaAsset";
import { SpaceMember } from "@/src/models/SpaceMember";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Our gallery",
  robots: { index: false, follow: false },
};

export default async function GalleryPage() {
  const user = await requireUser();
  await connectToDatabase();
  const membership = await SpaceMember.findOne({ userId: user._id }).sort({ joinedAt: 1 }).lean();
  const timestamps = membership
    ? await MediaAsset.find({ spaceId: membership.spaceId, status: "ready" }).select("_id createdAt").lean()
    : [];
  const mediaCreatedAt = Object.fromEntries(timestamps.map((asset) => [String(asset._id), asset.createdAt.toISOString()]));
  return <MemoryBrowser displayName={user.displayName} mediaCreatedAt={mediaCreatedAt} mode="gallery" />;
}

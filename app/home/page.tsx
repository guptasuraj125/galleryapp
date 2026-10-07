import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Video } from "lucide-react";
import { connectToDatabase } from "@/src/lib/mongodb";
import { requireUser } from "@/src/lib/auth";
import { BrandMark } from "@/src/components/brand-mark";
import { LogoutButton } from "@/src/components/logout-button";
import { ThemeToggle } from "@/src/components/theme-toggle";
import { MediaUploader } from "@/src/components/media-uploader";
import { Location } from "@/src/models/Location";
import { MediaAsset } from "@/src/models/MediaAsset";
import { Memory } from "@/src/models/Memory";
import { PrivateSpace } from "@/src/models/PrivateSpace";
import { SpaceMember } from "@/src/models/SpaceMember";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Our memories",
  robots: { index: false, follow: false },
};

export default async function PrivateHomePage() {
  const user = await requireUser();
  await connectToDatabase();

  const membership = await SpaceMember.findOne({ userId: user._id })
    .sort({ joinedAt: 1 })
    .lean();
  if (!membership) {
    notFound();
  }

  const space = await PrivateSpace.findById(membership.spaceId).lean();
  if (!space) {
    notFound();
  }

  const [memories, photos, videos, places] = await Promise.all([
    Memory.countDocuments({ spaceId: space._id }),
    MediaAsset.countDocuments({ spaceId: space._id, resourceType: "image", status: "ready" }),
    MediaAsset.countDocuments({ spaceId: space._id, resourceType: "video", status: "ready" }),
    Location.countDocuments({ spaceId: space._id }),
  ]);

  return (
    <main className="private-home">
      <header className="private-header">
        <BrandMark href="/home" />
        <div className="private-header-right">
          <span className="space-chip"><span className="privacy-dot" /> Private space</span>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <section className="private-main">
        <div className="welcome-block">
          <p className="eyebrow"><span className="eyebrow-dot" /> {space.name}</p>
          <h1>Hey, {user.displayName}.</h1>
          <p>Welcome back to our little archive.</p>
        </div>

        <div aria-label="Memory totals" className="stats-row">
          <div className="stat-item"><span className="stat-number">{memories}</span><span className="stat-label">memories</span></div>
          <div className="stat-item"><span className="stat-number">{photos}</span><span className="stat-label">photos</span></div>
          <div className="stat-item"><span className="stat-number">{videos}</span><span className="stat-label"><Video aria-hidden="true" size={12} /> videos</span></div>
          <div className="stat-item"><span className="stat-number">{places}</span><span className="stat-label"><MapPin aria-hidden="true" size={12} /> places</span></div>
        </div>

        <nav aria-label="Explore your memories" className="private-nav">
          <Link href="/gallery">Gallery</Link>
          <Link href="/videos">Videos</Link>
          <Link href="/timeline">Timeline</Link>
          <Link href="/places">Places</Link>
          <Link href="/favorites">Favorites</Link>
          <Link href="/on-this-day">On this day</Link>
          <Link href="/search">Search</Link>
          {membership.role === "owner" && <Link href="/members">Our people</Link>}
          <Link className="new-memory-link" href="/memories/new">Write a memory</Link>
        </nav>

        {memories === 0 && photos + videos === 0 ? (
          <section className="first-memory">
            <div aria-hidden="true" className="empty-flower">g</div>
            <h2>There&apos;s room for your first memory.</h2>
            <p>
              This space is ready for the photos, places, and little days you want to keep close.
            </p>
          </section>
        ) : memories === 0 ? (
          <section className="first-memory">
            <div aria-hidden="true" className="empty-flower">♡</div>
            <h2>Your photos are home.</h2>
            <p>
              {photos} {photos === 1 ? "photo" : "photos"} and {videos} {videos === 1 ? "video" : "videos"} are safely in {space.name}.
              You can turn them into memories soon.
            </p>
          </section>
        ) : (
          <section className="first-memory">
            <div aria-hidden="true" className="empty-flower">♡</div>
            <h2>Your archive is here.</h2>
            <p>
              {memories} {memories === 1 ? "memory is" : "memories are"} safely held in {space.name}.
            </p>
          </section>
        )}
        <MediaUploader />
      </section>
      <footer className="private-footer">private · personal · just us</footer>
    </main>
  );
}

import type { Metadata } from "next";
import { InviteAcceptance } from "@/src/components/invite-acceptance";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Accept an invitation",
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return <InviteAcceptance token={token} />;
}

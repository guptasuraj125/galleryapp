import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { MemberManager } from "@/src/components/member-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Our people",
  robots: { index: false, follow: false },
};

export default async function MembersPage() {
  const auth = await getUserSpaceMembership();
  if (!auth) redirect("/login");
  if (auth.membership.role !== "owner") notFound();
  return <MemberManager />;
}

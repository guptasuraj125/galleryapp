import type { Metadata } from "next";
import { MemoryBrowser } from "@/src/components/memory-browser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Search our memories",
  robots: { index: false, follow: false },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  return <MemoryBrowser initialQuery={q.slice(0, 100)} mode="search" />;
}

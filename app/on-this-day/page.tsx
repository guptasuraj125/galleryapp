import type { Metadata } from "next";
import { MemoryBrowser } from "@/src/components/memory-browser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "On this day",
  robots: { index: false, follow: false },
};

export default function OnThisDayPage() {
  return <MemoryBrowser mode="on-this-day" />;
}

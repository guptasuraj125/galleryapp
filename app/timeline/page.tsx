import type { Metadata } from "next";
import { MemoryBrowser } from "@/src/components/memory-browser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Our timeline",
  robots: { index: false, follow: false },
};

export default function TimelinePage() {
  return <MemoryBrowser mode="timeline" />;
}

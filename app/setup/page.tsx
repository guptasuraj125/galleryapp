import type { Metadata } from "next";
import { SetupForm } from "@/src/components/setup-form";

export const metadata: Metadata = {
  title: "Set up your private space · ghumi.ghumi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function SetupPage() {
  return <SetupForm />;
}

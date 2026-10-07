import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import { NewMemoryForm } from "@/src/components/new-memory-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "A new memory",
  robots: { index: false, follow: false },
};

export default async function NewMemoryPage() {
  if (!await getCurrentUser()) redirect("/login");
  return <NewMemoryForm />;
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { readJson } from "@/src/lib/api-response";
import { ThemeToggle } from "@/src/components/theme-toggle";

export function NewMemoryForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await readJson<{ id: string }>(await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          caption: String(form.get("caption") ?? ""),
          note: String(form.get("note") ?? ""),
          occurredAt: String(form.get("occurredAt") ?? ""),
          locationName: String(form.get("locationName") ?? "").trim() || undefined,
          tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      }));
      router.replace(`/gallery?memory=${encodeURIComponent(result.id)}`);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "This memory could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="library-page">
      <header className="library-header">
        <Link className="library-back" href="/home"><ArrowLeft size={16} /> Our space</Link>
        <div className="library-header-actions">
          <Link href="/gallery">Our archive</Link>
          <ThemeToggle />
        </div>
      </header>
      <section className="memory-composer">
        <p className="eyebrow">Save a little day</p>
        <h1>A new memory</h1>
        <p>Keep a moment here now; you can add its photos after uploading them.</p>
        <form className="memory-edit-form" onSubmit={submit}>
          <label>Title<input autoFocus maxLength={160} name="title" placeholder="First date, late-summer light…" required /></label>
          <label>Date<input defaultValue={new Date().toISOString().slice(0, 10)} name="occurredAt" required type="date" /></label>
          <label>Place<input maxLength={160} name="locationName" placeholder="A little place we love" /></label>
          <label>Tags<input name="tags" placeholder="sunset, us, weekend" /></label>
          <label>Caption<textarea maxLength={5000} name="caption" placeholder="What do you want to remember about it?" rows={4} /></label>
          <label>A private note<textarea maxLength={10000} name="note" placeholder="Just for the two of you…" rows={4} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={saving} type="submit">{saving ? "Keeping it safe…" : "Save memory"}</button>
        </form>
      </section>
    </main>
  );
}

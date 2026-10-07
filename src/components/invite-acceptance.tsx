"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandMark } from "@/src/components/brand-mark";
import { ThemeToggle } from "@/src/components/theme-toggle";
import { readJson } from "@/src/lib/api-response";

export function InviteAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await readJson(await fetch("/api/members/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          displayName: String(form.get("displayName") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      }));
      router.replace("/home");
      router.refresh();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "This invite could not be accepted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-theme-toggle"><ThemeToggle /></div>
      <section className="auth-card">
        <div className="auth-brand"><BrandMark /></div>
        <p className="eyebrow">You have a little place here</p>
        <h1>Come be part of it.</h1>
        <p className="auth-intro">Choose your name and a password to accept this private invitation.</p>
        {!token ? <p className="form-error" role="alert">This invitation link is missing its token.</p> : (
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="displayName">Your name</label>
            <input autoComplete="name" id="displayName" maxLength={80} name="displayName" required />
            <label htmlFor="password">Password (at least 8 characters)</label>
            <input autoComplete="new-password" id="password" maxLength={72} minLength={8} name="password" required type="password" />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" disabled={submitting} type="submit">{submitting ? "Opening your space…" : "Accept invitation"}</button>
          </form>
        )}
        <p className="auth-footnote">Already have an account? <Link href="/login">Sign in and ask the owner to add you.</Link></p>
      </section>
    </main>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { BrandMark } from "@/src/components/brand-mark";
import { ThemeToggle } from "@/src/components/theme-toggle";

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Setup couldn't be completed. Please check your details.");
        return;
      }
      router.replace("/home");
      router.refresh();
    } catch {
      setError("Your connection took a little break. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div aria-hidden="true" className="auth-glow" />
      <div className="auth-theme-toggle"><ThemeToggle /></div>
      <section className="auth-card setup-card">
        <div className="auth-brand"><BrandMark /></div>
        <p className="eyebrow"><LockKeyhole size={13} /> First-time setup</p>
        <h1>Make it yours.</h1>
        <p className="auth-intro">
          Create your private space and its first owner account. Keep your setup key private.
        </p>
        <form className="auth-form setup-form" onSubmit={handleSubmit}>
          <label htmlFor="setupToken">One-time setup key</label>
          <input autoComplete="off" id="setupToken" name="setupToken" required type="password" />
          <label htmlFor="displayName">Your name</label>
          <input autoComplete="name" id="displayName" maxLength={80} name="displayName" required />
          <label htmlFor="email">Email</label>
          <input autoComplete="email" id="email" maxLength={254} name="email" required type="email" />
          <label htmlFor="password">Password (at least 8 characters)</label>
          <input
            autoComplete="new-password"
            id="password"
            maxLength={72}
            minLength={8}
            name="password"
            required
            type="password"
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" disabled={submitting} type="submit">
            {submitting ? "Preparing your space..." : "Create our space"}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>
        <p className="auth-footnote">
          Already set up? <a href="/login">Sign in</a>
        </p>
      </section>
    </main>
  );
}

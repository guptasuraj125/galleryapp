"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { BrandMark } from "@/src/components/brand-mark";
import { ThemeToggle } from "@/src/components/theme-toggle";

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const result = await response.json().catch((): { error?: string } | null => null);

      if (!response.ok) {
        setError(
          result?.error ??
            (response.status >= 500
              ? "Sign-in is temporarily unavailable. Please try again in a moment."
              : "We couldn't open the door. Try again in a moment."),
        );
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
      <header className="auth-topbar">
        <Link className="back-link" href="/">
          <ArrowLeft size={16} /> Back to our little door
        </Link>
        <span className="private-indicator"><LockKeyhole size={12} /> Private space</span>
        <ThemeToggle />
      </header>

      <section className="auth-card">
        <div className="auth-brand"><BrandMark /></div>
        <p className="eyebrow">Good to have you back</p>
        <h1>Come on in.</h1>
        <p className="auth-intro">Your memories are right where you left them.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="identifier">Email or username</label>
          <input
            autoComplete="username"
            id="identifier"
            maxLength={254}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="you@example.com"
            required
            value={identifier}
          />

          <div className="password-label">
            <label htmlFor="password">Password</label>
          </div>
          <div className="password-input">
            <input
              autoComplete="current-password"
              id="password"
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="password-toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="primary-button auth-submit" disabled={submitting} type="submit">
            {submitting ? "Opening your space..." : "Enter our space"}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="auth-footnote">
          First time here? <Link href="/setup">Create your private space</Link>
        </p>
      </section>
      <footer className="auth-footer">ghumi.ghumi · our little corner of the internet</footer>
    </main>
  );
}

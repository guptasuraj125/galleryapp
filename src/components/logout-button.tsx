"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("Sign out failed.");
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setPending(false);
      setError("We couldn't sign you out. Please try again.");
    }
  }

  return (
    <div>
      {error && <span className="form-error" role="alert">{error} </span>}
      <button className="logout-button" disabled={pending} onClick={logout} type="button">
        {pending ? "Leaving..." : "Log out"}
      </button>
    </div>
  );
}

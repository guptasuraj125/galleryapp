"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type ThemeChoice = "light" | "dark" | "system";
const themeChangeEvent = "ghumi-theme-change";

function readChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem("ghumi-theme");
    if (value === "dark" || value === "light" || value === "system") return value;
  } catch { /* Use system preference when storage is unavailable. */ }
  return "system";
}

function applyChoice(choice: ThemeChoice) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

function subscribe(onChange: () => void) {
  const refresh = () => {
    applyChoice(readChoice());
    onChange();
  };
  window.addEventListener(themeChangeEvent, refresh);
  window.addEventListener("storage", refresh);
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  system.addEventListener("change", refresh);
  return () => {
    window.removeEventListener(themeChangeEvent, refresh);
    window.removeEventListener("storage", refresh);
    system.removeEventListener("change", refresh);
  };
}

export function ThemeToggle() {
  const choice = useSyncExternalStore<ThemeChoice>(subscribe, readChoice, () => "system" as ThemeChoice);
  const isDark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme === "dark",
    () => false,
  );

  useEffect(() => {
    applyChoice(choice);
  }, [choice]);

  function updateTheme(next: ThemeChoice) {
    try {
      if (next === "system") window.localStorage.removeItem("ghumi-theme");
      else window.localStorage.setItem("ghumi-theme", next);
    } catch { /* Keep the theme usable for this page session. */ }
    applyChoice(next);
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  return (
    <button
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className="theme-toggle"
      onClick={() => updateTheme(isDark ? "light" : "dark")}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      type="button"
    >
      {isDark ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
    </button>
  );
}

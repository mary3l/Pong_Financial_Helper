"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/icons";
import { THEME_KEY as KEY, THEME_SCRIPT } from "@/lib/theme-script";

export type ThemeChoice = "system" | "light" | "dark";

/**
 * The theme script for <head>. It runs from the server HTML; on the client
 * it's inert text/plain, so React doesn't warn about rendering a script.
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}

declare global {
  interface Window {
    __applyTheme?: () => void;
  }
}

const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function choose(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: still switch for this visit.
  }
  if (window.__applyTheme) window.__applyTheme();
  else {
    const dark =
      choice === "dark" ||
      (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * One tap between light and dark, beside the avatar at the top of every page. The moon shows
 * in light mode and the sun in dark, by CSS, so it's right before hydration.
 */
export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={() => choose(document.documentElement.dataset.theme === "dark" ? "light" : "dark")}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-ink hover:bg-sea-tint"
    >
      <span className="contents dark:hidden">
        <MoonIcon size={22} />
        <span className="sr-only">Switch to dark mode</span>
      </span>
      <span className="hidden dark:contents">
        <SunIcon size={22} />
        <span className="sr-only">Switch to light mode</span>
      </span>
    </button>
  );
}

/** System / Light / Dark, for Settings. Saved on this device only. */
export function ThemePicker() {
  // null on the server and during hydration, so nothing mismatches.
  const current = useSyncExternalStore<ThemeChoice | null>(subscribe, read, () => null);

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Theme" className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={current === o.value}
            onClick={() => choose(o.value)}
            className={`h-10 rounded-full px-4 text-sm font-extrabold ${
              current === o.value ? "bg-ink text-mint" : "bg-mint text-ink hover:bg-sea-tint"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted">
        System follows your phone&apos;s dark mode setting. Saved on this device.
      </p>
    </div>
  );
}

"use client";

import { useEffect, useSyncExternalStore } from "react";

// One short message after a save, like "Saved · ₱59 · Dec 16 bill". It lives
// outside any form, so it stays up while the form closes and the page changes.

type Toast = { id: number; text: string };

let current: Toast | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Shows `text` for a few seconds, replacing any message already up. */
export function showToast(text: string) {
  current = { id: (current?.id ?? 0) + 1, text };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const TOAST_MS = 3000;

/** Where the message shows: above the bottom bar on phones, bottom corner on desktop. */
export function Toaster() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      if (current?.id === toast.id) {
        current = null;
        emit();
      }
    }, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-6"
    >
      {toast && (
        <span
          key={toast.id}
          className="rounded-full bg-ink px-4 py-2.5 text-sm font-extrabold text-mint shadow-lg"
        >
          {toast.text}
        </span>
      )}
    </div>
  );
}

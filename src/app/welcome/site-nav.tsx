"use client";

import { useSyncExternalStore } from "react";
import { Pong } from "@/components/pong";

const LINKS = [
  ["#why", "Why Pong"],
  ["#features", "Features"],
  ["#try", "Try it"],
  ["#faq", "Questions"],
] as const;

const onScroll = (cb: () => void) => {
  window.addEventListener("scroll", cb, { passive: true });
  return () => window.removeEventListener("scroll", cb);
};

/**
 * The landing page's top bar: sticky, with a shadow so it reads as a bar,
 * and a deeper one once the page has scrolled. Section links on wide screens.
 */
export function SiteNav() {
  const scrolled = useSyncExternalStore(
    onScroll,
    () => window.scrollY > 8,
    () => false,
  );

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-30 bg-card shadow-[0_2px_10px_-4px_rgba(0,0,0,0.18)] transition-shadow duration-300 data-[scrolled=true]:shadow-[0_8px_24px_-10px_rgba(0,0,0,0.35)]"
    >
      <nav
        aria-label="Landing page"
        className="mx-auto flex h-16 w-full max-w-[1100px] items-center justify-between px-6"
      >
        <a href="#top" className="flex items-center gap-2 font-display text-xl font-semibold">
          <Pong mood="happy" size={36} decorative />
          Pong Money
        </a>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                className="rounded-full px-3.5 py-2 text-[15px] font-bold text-muted transition-colors hover:bg-sea-tint hover:text-sea-dark"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

const noChange = () => () => {};

/** This year, filled in by the browser (the page itself is built once). */
export function ThisYear() {
  return useSyncExternalStore(
    noChange,
    () => new Date().getFullYear(),
    () => null,
  );
}

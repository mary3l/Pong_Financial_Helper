"use client";

import { useRef, useState } from "react";
import { Pong } from "@/components/pong";

// Three sample screens of the app for the landing page, drawn in code with
// fixed numbers. Each is labelled "Sample" and hidden from screen readers:
// the caption under it says the same thing in words.

function Phone({ children, tint = "bg-mint" }: { children: React.ReactNode; tint?: string }) {
  return (
    <div
      aria-hidden="true"
      className="phone-float relative mx-auto h-[440px] w-[230px] shrink-0 rounded-[38px] border-[7px] border-ink bg-ink p-0 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.45)]"
    >
      <div className={`flex h-full flex-col gap-2.5 overflow-hidden rounded-[30px] ${tint} p-3`}>
        <div className="mx-auto mb-1 h-1.5 w-16 rounded-full bg-ink/80" />
        {children}
      </div>
      <span className="absolute -top-3 -right-3 rotate-6 rounded-full bg-sun px-2.5 py-1 text-[11px] font-extrabold text-ink">
        Sample
      </span>
    </div>
  );
}

function HomeScreen() {
  return (
    <Phone>
      <p className="px-1 font-display text-sm font-semibold text-ink">Hi, Ana!</p>
      <div className="relative overflow-hidden rounded-[20px] bg-sea p-3.5 text-white">
        <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-sea-light" />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold text-sea-text">LEFT TODAY</p>
            <p className="font-display text-3xl leading-none font-semibold">₱540</p>
            <p className="mt-1 text-[11px] text-sea-text">Budget ₱3,780 this week</p>
          </div>
          <Pong mood="happy" size={52} decorative className="pong-peek -mt-1 -mr-1" />
        </div>
        <p className="relative mt-2 rounded-[12px_4px_12px_12px] bg-sea-deep/60 px-2.5 py-1.5 text-[11px] text-sea-text">
          You&apos;re on track. Payday in 6 days!
        </p>
      </div>
      <p className="px-1 text-[11px] font-extrabold text-muted">COMING UP</p>
      {[
        ["Payday", "On the 15th", "+₱12,000"],
        ["Meralco", "Due the 20th", "₱2,150"],
        ["Rent", "Due the 30th", "₱6,000"],
      ].map(([name, when, amt]) => (
        <div
          key={name}
          className="flex items-center justify-between rounded-[14px] bg-card px-3 py-2"
        >
          <div>
            <p className="text-xs font-extrabold text-ink">{name}</p>
            <p className="text-[10px] text-muted">{when}</p>
          </div>
          <p
            className={`text-xs font-extrabold ${amt.startsWith("+") ? "text-sea-dark" : "text-ink"}`}
          >
            {amt}
          </p>
        </div>
      ))}
    </Phone>
  );
}

function BillsScreen() {
  const due: Record<number, string> = { 5: "bg-coral", 15: "bg-sea", 20: "bg-coral", 30: "bg-sea" };
  return (
    <Phone>
      <p className="px-1 font-display text-sm font-semibold text-ink">Bills · November</p>
      <div className="rounded-[18px] bg-card p-2.5">
        <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-muted">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
          {Array.from({ length: 30 }, (_, i) => i + 1).map((day) => (
            <span
              key={day}
              className={`flex h-5 items-center justify-center rounded-full text-[9px] ${
                due[day] ? `${due[day]} font-extrabold text-white` : "text-ink"
              }`}
            >
              {day}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="rounded-[14px] bg-sea-tint px-3 py-2">
          <p className="text-[11px] font-extrabold text-ink">Payday 15 covers</p>
          <p className="text-[10px] text-muted">Meralco ₱2,150 · Globe ₱1,299</p>
        </div>
        <div className="rounded-[14px] bg-sun-tint px-3 py-2">
          <p className="text-[11px] font-extrabold text-ink">Payday 30 covers</p>
          <p className="text-[10px] text-muted">Rent ₱6,000 · Card ₱3,400</p>
        </div>
      </div>
    </Phone>
  );
}

function GroceryScreen() {
  return (
    <Phone>
      <p className="px-1 font-display text-sm font-semibold text-ink">Grocery mode</p>
      <div className="rounded-[18px] bg-card p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-bold text-muted">CART</p>
          <p className="text-[10px] font-bold text-muted">Budget ₱2,000</p>
        </div>
        <p className="font-display text-3xl leading-none font-semibold text-ink">₱1,640</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-key">
          <div className="h-full w-[82%] rounded-full bg-sun" />
        </div>
        <p className="mt-1 text-[10px] text-muted">₱360 left</p>
      </div>
      {[
        ["Fresh milk 1L", "₱95", "₱0.095/ml"],
        ["Fresh milk 2L", "₱168", "₱0.084/ml"],
      ].map(([name, price, unit], i) => (
        <div
          key={name}
          className="flex items-center justify-between rounded-[14px] bg-card px-3 py-2"
        >
          <div>
            <p className="text-xs font-extrabold text-ink">{name}</p>
            <p className="text-[10px] text-muted">{unit}</p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <p className="text-xs font-extrabold text-ink">{price}</p>
            {i === 1 && (
              <span className="rounded-full bg-sea px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                Cheaper per ml
              </span>
            )}
          </div>
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2 rounded-[14px] bg-sea-tint px-3 py-2">
        <Pong mood="proud" size={34} decorative />
        <p className="text-[10px] font-bold text-ink">The 2L saves you ₱22. Nice!</p>
      </div>
    </Phone>
  );
}

const SCREENS = [
  {
    key: "home",
    Screen: HomeScreen,
    caption: "Home: what's safe to spend today, and what's coming up.",
  },
  {
    key: "bills",
    Screen: BillsScreen,
    caption: "Bills: every due date, matched to the payday that covers it.",
  },
  {
    key: "grocery",
    Screen: GroceryScreen,
    caption: "Grocery mode: a running total, and the better deal per ml.",
  },
];

/** Side by side on wide screens; a sideways swipe with dots on phones. */
export function Screens() {
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      <ul
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="-mx-6 flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pt-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0"
      >
        {SCREENS.map(({ key, Screen, caption }, i) => (
          <li
            key={key}
            style={{ "--i": i } as React.CSSProperties}
            className="stagger flex w-full shrink-0 snap-center flex-col gap-4 md:w-auto"
          >
            <Screen />
            <p className="mx-auto max-w-[260px] text-center text-[15px] leading-snug text-muted">
              {caption}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex justify-center gap-2 md:hidden">
        {SCREENS.map(({ key }, i) => (
          <button
            key={key}
            type="button"
            aria-label={`Show screen ${i + 1} of ${SCREENS.length}`}
            aria-current={active === i}
            onClick={() => {
              const el = track.current;
              el?.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
            }}
            className={`h-2.5 rounded-full transition-all ${active === i ? "w-6 bg-sea" : "w-2.5 bg-line"}`}
          />
        ))}
      </div>
    </div>
  );
}

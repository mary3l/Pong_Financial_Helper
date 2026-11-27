"use client";

import { useId, useState } from "react";
import { Pong } from "@/components/pong";
import { formatPeso } from "@/lib/money";
import { clampDays, dailySafe, pesos, pongFor } from "./daily";

const FIELD =
  "h-12 rounded-[14px] border-2 border-line bg-card px-3 text-base font-bold text-ink outline-none focus:border-sea";

function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 text-sm font-bold">
      <label htmlFor={id}>{label}</label>
      <span className="relative">
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-3 -translate-y-1/2 font-bold text-muted"
        >
          ₱
        </span>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD} w-full pl-7`}
        />
      </span>
    </div>
  );
}

/** "How much can I spend a day?": a rough taste of Safe to spend, nothing saved. */
export function TryIt() {
  const [pay, setPay] = useState("12000");
  const [bills, setBills] = useState("4500");
  const [savings, setSavings] = useState("1000");
  const [days, setDays] = useState(15);

  const daily = dailySafe(pesos(pay), pesos(bills), pesos(savings), days);
  const pong = pongFor(daily);
  const step = (by: number) => setDays((d) => clampDays(d + by));

  return (
    <div className="grid gap-6 rounded-[28px] bg-card p-6 shadow-[0_2px_0_var(--color-line)] md:grid-cols-2 md:p-8">
      <div className="flex flex-col gap-4">
        <Money label="Sweldo this payday" value={pay} onChange={setPay} />
        <Money label="Bills before the next payday" value={bills} onChange={setBills} />
        <Money label="Savings to set aside" value={savings} onChange={setSavings} />
        <div className="flex flex-col gap-1.5 text-sm font-bold">
          <span id="days-label">Days until payday</span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="days-label">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="One day fewer"
              className="h-12 w-12 rounded-[14px] bg-key text-xl font-extrabold"
            >
              −
            </button>
            <input
              aria-labelledby="days-label"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(clampDays(Number(e.target.value)))}
              className={`${FIELD} w-20 text-center`}
            />
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="One day more"
              className="h-12 w-12 rounded-[14px] bg-key text-xl font-extrabold"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex flex-col justify-center gap-3 overflow-hidden rounded-[24px] bg-sea p-6 text-white">
        <div
          aria-hidden="true"
          className="absolute -top-12 -right-10 h-40 w-40 rounded-full bg-sea-light"
        />
        <div className="relative flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1" aria-live="polite">
            <span className="text-sm font-bold text-sea-text">YOU CAN SPEND</span>
            <output className="font-display text-5xl leading-none font-semibold">
              {daily > 0 ? formatPeso(daily) : "₱0"}
            </output>
            <span className="text-[15px] text-sea-text">a day until payday</span>
          </div>
          <Pong
            key={pong.mood}
            mood={pong.mood}
            size={96}
            className="pop-in shrink-0 drop-shadow-[0_3px_0_rgba(0,0,0,0.18)]"
          />
        </div>
        <p className="relative rounded-[18px_6px_18px_18px] bg-sea-deep/60 px-3.5 py-2.5 text-[15px] leading-snug text-sea-text">
          {pong.message}
        </p>
        <p className="relative text-xs text-sea-text">
          Rough estimate. The app also counts loans, cards and what you&apos;ve already spent.
        </p>
        <a
          href="#start"
          className="relative flex h-12 items-center justify-center rounded-[16px] bg-sun font-extrabold text-ink"
        >
          Let Pong track it for real →
        </a>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pong } from "@/components/pong";
import { formatPeso } from "@/lib/money";
import { clampDays, dailySafe, leftover, pesos, pongFor } from "./daily";
import { pickDemo } from "./demo-store";

const FIELD =
  "h-12 rounded-[14px] border-2 border-line bg-card px-3 text-base font-bold text-ink outline-none focus:border-sea";

const peso = (n: number) => (n > 0 ? formatPeso(n) : "₱0");

const motionOk = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

/** Counts the shown number up (or down) to `target`; jumps straight there with reduced motion. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (!motionOk()) {
      from.current = target;
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    const began = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 450);
      const eased = 1 - (1 - t) ** 3;
      const value = Math.round(start + (target - start) * eased);
      from.current = value;
      setShown(value);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target]);

  return shown;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="stagger flex gap-3" style={{ "--i": n } as React.CSSProperties}>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sea font-display text-base font-semibold text-white"
      >
        {n}
      </span>
      <div className="flex flex-1 flex-col gap-2.5">
        <p className="pt-1 font-extrabold">{title}</p>
        {children}
      </div>
    </li>
  );
}

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
    <div className="flex flex-col gap-1 text-sm font-bold text-muted">
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

/** "How much can I spend a day?": Pong's three steps, live. Nothing is saved. */
export function TryIt() {
  const [pay, setPay] = useState("12000");
  const [bills, setBills] = useState("4500");
  const [savings, setSavings] = useState("1000");
  const [days, setDays] = useState(15);

  const left = leftover(pesos(pay), pesos(bills), pesos(savings));
  const daily = dailySafe(pesos(pay), pesos(bills), pesos(savings), days);
  const pong = pongFor(daily);
  const shown = useCountUp(Math.max(0, daily));
  const step = (by: number) => setDays((d) => clampDays(d + by));
  const dayWord = days === 1 ? "day" : "days";

  return (
    <div className="grid gap-6 rounded-[28px] bg-card p-6 shadow-[0_2px_0_var(--color-line)] md:grid-cols-[1fr_1.1fr] md:p-8">
      <ol className="flex flex-col gap-5">
        <Step n={1} title="Tell Pong your sweldo">
          <Money label="Sweldo this payday" value={pay} onChange={setPay} />
        </Step>
        <Step n={2} title="Pong sets aside what can't be spent">
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Bills before the next payday" value={bills} onChange={setBills} />
            <Money label="Savings to set aside" value={savings} onChange={setSavings} />
          </div>
        </Step>
        <Step n={3} title="Pong splits the rest by day">
          <div className="flex flex-col gap-1 text-sm font-bold text-muted">
            <span id="days-label">Days until payday</span>
            <div className="flex items-center gap-2" role="group" aria-labelledby="days-label">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="One day fewer"
                className="h-12 w-12 rounded-[14px] bg-key text-xl font-extrabold text-ink active:scale-95"
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
                className="h-12 w-12 rounded-[14px] bg-key text-xl font-extrabold text-ink active:scale-95"
              >
                +
              </button>
            </div>
          </div>
        </Step>
      </ol>

      <div className="relative flex flex-col justify-center gap-4 overflow-hidden rounded-[24px] bg-sea p-6 text-white">
        <div
          aria-hidden="true"
          className="absolute -top-12 -right-10 h-40 w-40 rounded-full bg-sea-light"
        />

        {/* Pong's working, line by line. */}
        <div className="relative flex flex-col gap-1.5 rounded-[18px] bg-sea-deep/60 p-4 text-[15px] text-sea-text">
          <p data-testid="math-left">
            <span className="font-bold text-white">{peso(pesos(pay))}</span> − {peso(pesos(bills))}{" "}
            − {peso(pesos(savings))} ={" "}
            <span className="font-extrabold text-sun">{peso(left)} left</span>
          </p>
          <p data-testid="math-split">
            <span className="font-bold text-white">{peso(left)}</span> ÷ {days} {dayWord} ={" "}
            <span className="font-extrabold text-sun">{peso(daily)} a day</span>
          </p>
        </div>

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold text-sea-text">YOU CAN SPEND</span>
            {/* The real amount for screen readers; the counting one is for eyes. */}
            <output className="sr-only">{peso(daily)}</output>
            <span
              aria-hidden="true"
              className="font-display text-5xl leading-none font-semibold tabular-nums"
            >
              {peso(shown)}
            </span>
            <span className="text-[15px] text-sea-text">a day until payday</span>
          </div>
          <Pong
            key={pong.mood}
            mood={pong.mood}
            size={96}
            className="pop-in shrink-0 drop-shadow-[0_3px_0_rgba(0,0,0,0.18)]"
          />
        </div>
        <p
          key={pong.message}
          className="pop-in relative rounded-[18px_6px_18px_18px] bg-card px-3.5 py-2.5 text-[15px] leading-snug font-bold text-ink"
        >
          {pong.message}
        </p>
        <p className="relative text-xs text-sea-text">
          Rough estimate. The app also counts loans, cards and what you&apos;ve already spent.
        </p>
        <a
          href="#start"
          onClick={(e) => {
            e.preventDefault();
            pickDemo(daily);
            document
              .getElementById("start")
              ?.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "center" });
          }}
          className="shine relative flex h-12 items-center justify-center overflow-hidden rounded-[16px] bg-sun font-extrabold text-ink"
        >
          Let Pong track it for real →
        </a>
      </div>
    </div>
  );
}

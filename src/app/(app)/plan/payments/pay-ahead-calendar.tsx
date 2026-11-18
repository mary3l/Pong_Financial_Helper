"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronIcon, CloseIcon } from "@/components/icons";
import { LogButton } from "@/components/log-button";
import { formatPesoShort } from "@/lib/bill-calendar";
import type { Account } from "@/lib/data";
import {
  addDays,
  daysBetween,
  formatLongDay,
  formatRelativeDay,
  formatShortDay,
  weekdayOf,
} from "@/lib/dates";
import { lowestBetween, type ForecastItem } from "@/lib/forecast";
import { formatPeso, roundCents } from "@/lib/money";
import {
  checkDay,
  cleanLocks,
  firstSafeDay,
  monthGrid,
  PAY_AHEAD_KEY,
  parseLocks,
  planWithLocks,
  shiftMonth,
  type Locks,
} from "@/lib/pay-ahead";
import { PLAN_FLOOR, type PaymentPlan } from "@/lib/payment-plan";

// Plan › Payments › Calendar: plan the day you'll pay each payment. Tap one
// to pick its day in a sheet; × on a planned one takes the plan off.
// Grey days would take you under ₱1,000 before it's due; every planned
// payment comes out of the plan, so the others' grey days move with it.
// Plans are remembered on this device: only "Pay" logs anything, asking
// which wallet (and for a bill that varies, whether the estimate is right).

const listeners = new Set<() => void>();
/** This visit's plans, for when storage is blocked. */
let memory: string | null = null;
let cache: { raw: string | null; locks: Locks } = { raw: null, locks: {} };
const NONE: Locks = {};

function readRaw(): string | null {
  try {
    return localStorage.getItem(PAY_AHEAD_KEY);
  } catch {
    return memory;
  }
}

/** The same object until storage changes, as useSyncExternalStore needs. */
function snapshot(): Locks {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, locks: parseLocks(raw) };
  return cache.locks;
}

function save(locks: Locks) {
  const raw = JSON.stringify(locks);
  memory = raw;
  try {
    localStorage.setItem(PAY_AHEAD_KEY, raw);
  } catch {
    // Storage blocked: keep them for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
/** "Jan 15", even in another year: paydays are never far off. */
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function PayAheadCalendar({
  start,
  items,
  held,
  candidates,
  today,
  paydays,
  accounts,
}: {
  /** Spending money at the start of today. */
  start: number;
  items: ForecastItem[];
  /** The BNPL caps, held on their bill days. */
  held: ForecastItem[];
  /** Loan payments and bills you can pay ahead, soonest first. */
  candidates: ForecastItem[];
  today: string;
  /** Upcoming paydays not received yet, soonest first. */
  paydays: string[];
  accounts: Account[];
}) {
  const stored = useSyncExternalStore(subscribe, snapshot, () => NONE);
  const locks = useMemo(() => cleanLocks(stored, candidates, today), [stored, candidates, today]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const plan = useMemo(
    () => planWithLocks({ start, items, held, locks, today }),
    [start, items, held, locks, today],
  );
  const before = useMemo(
    () => planWithLocks({ start, items, held, locks: {}, today }),
    [start, items, held, today],
  );

  if (!candidates.length) {
    return (
      <p className="rounded-[20px] bg-card px-4 py-3 text-[15px] text-muted">
        Nothing to pay ahead.
      </p>
    );
  }

  const day = (date: string) => (date === today ? "Today" : formatShortDay(date, today));

  function setLock(key: string, date: string | null) {
    const next = { ...locks };
    if (date) next[key] = date;
    else delete next[key];
    save(next);
  }

  // The answer: still safe or not, the lowest day before the pay after next, and today's amount.
  const low = lowestBetween(plan.days, today, paydays[1] ?? addDays(today, 30));
  const tight = plan.short || (low !== null && low.balance < PLAN_FLOOR);
  const change = plan.perDay - before.perDay;
  const planned = candidates.filter((c) => locks[c.key]);

  // What happens next: each planned day, its payments and total. Today's each get Pay.
  const byDay = new Map<string, ForecastItem[]>();
  for (const c of planned) byDay.set(locks[c.key], [...(byDay.get(locks[c.key]) ?? []), c]);
  const days = [...byDay.keys()].sort();
  const total = (list: ForecastItem[]) => roundCents(list.reduce((sum, c) => sum + c.amount!, 0));
  const walletName = (id: string | null) => accounts.find((a) => a.id === id)?.name;

  /** "Pay anytime", "Wait for Dec 15 pay", "Planned · Tomorrow", … */
  function statusOf(c: ForecastItem): { label: string; tone: string } {
    if (locks[c.key])
      return {
        label: `Planned · ${formatRelativeDay(locks[c.key], today)}`,
        tone: "bg-sea text-white",
      };
    const first = firstSafeDay(c, plan, locks, today);
    if (first === today) return { label: "Pay anytime", tone: "bg-sea-tint text-sea-dark" };
    if (first === c.dueOn) return { label: "Pay on due day", tone: "bg-key text-muted" };
    return {
      label: paydays.includes(first)
        ? `Wait for ${MONTH_DAY.format(Date.parse(`${first}T00:00:00Z`))} pay`
        : `Wait till ${day(first)}`,
      tone: "bg-key text-muted",
    };
  }

  const openItem = candidates.find((c) => c.key === openKey) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <section className="flex items-center justify-between gap-3 rounded-[20px] bg-sea px-4 py-3 text-white">
        <span className="flex min-w-0 flex-col">
          <span className={`font-display text-[22px] font-semibold ${tight ? "text-sun" : ""}`}>
            {tight ? "✗ Too tight" : "✓ Still safe"}
          </span>
          {low && (
            <span className="text-[13px] text-sea-text">
              Lowest {formatPeso(low.balance)} · {day(low.date)}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-display text-[22px] font-semibold">{formatPeso(plan.perDay)}</span>
          <span className="text-[13px] text-sea-text">
            a day
            {planned.length
              ? change === 0
                ? " · same"
                : ` · ${change > 0 ? "+" : "−"}${formatPeso(Math.abs(change))}`
              : ""}
          </span>
        </span>
      </section>

      <MonthView
        today={today}
        last={plan.days.at(-1)?.date ?? today}
        candidates={candidates}
        locks={locks}
        pays={items.filter((i) => i.kind === "payday" && !i.transactionId && i.dueOn >= today)}
      />

      {days.length > 0 && (
        <section aria-label="Planned" className="flex flex-col rounded-[20px] bg-card px-4 py-1">
          {days.map((date) => {
            const list = byDay.get(date)!;
            return (
              <div
                key={date}
                className="flex flex-col border-t border-line-soft py-2.5 first:border-0"
              >
                <span className="font-bold">
                  {formatRelativeDay(date, today)} · pay {list.length} · {formatPeso(total(list))}
                </span>
                {date === today ? (
                  <ul className="flex flex-col">
                    {list.map((c) => (
                      <li key={c.key} className="flex items-center gap-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[15px]">{c.name}</span>
                        <span className="font-display text-[15px] font-semibold">
                          {formatPeso(c.amount!)}
                          {c.estimate && (
                            <span className="font-sans text-xs font-bold text-muted"> est.</span>
                          )}
                        </span>
                        <LogButton item={c} accounts={accounts} label="Pay" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="truncate text-[13px] text-muted">
                    {list.map((c) => c.name).join(", ")}
                  </span>
                )}
              </div>
            );
          })}
        </section>
      )}

      <ul
        aria-label="Payments you can pay ahead"
        className="flex flex-col rounded-[20px] bg-card px-2 py-1"
      >
        {candidates.map((c) => {
          const status = statusOf(c);
          return (
            <li
              key={c.key}
              className="flex items-center gap-1 border-t border-line-soft first:border-0"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`Pick a day to pay ${c.name}`}
                onClick={() => setOpenKey(c.key)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-line-soft"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate font-bold">{c.name}</span>
                    {c.lastPayment && (
                      <span className="rounded-full bg-sea-tint px-2 text-xs font-extrabold text-sea-dark">
                        Last
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] text-muted">
                    Due {day(c.dueOn)}
                    {walletName(c.accountId) ? ` · ${walletName(c.accountId)}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="font-display text-[17px] font-semibold">
                    {formatPeso(c.amount!)}
                    {c.estimate && (
                      <span className="font-sans text-xs font-bold text-muted"> est.</span>
                    )}
                  </span>
                  <span className={`rounded-full px-2 text-xs font-extrabold ${status.tone}`}>
                    {status.label}
                  </span>
                </span>
              </button>
              {locks[c.key] && (
                <button
                  type="button"
                  onClick={() => setLock(c.key, null)}
                  aria-label={`Remove the plan for ${c.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-key text-muted hover:text-ink"
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {openItem && (
        <DaySheet
          key={openItem.key}
          item={openItem}
          plan={plan}
          locks={locks}
          today={today}
          paydays={paydays}
          onPick={(date) => {
            setLock(openItem.key, date);
            setOpenKey(null);
          }}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

/**
 * The days you could pay `item`, from today until it's due, in weeks from
 * Sunday. A clear day plans it and closes; its planned day or its due day
 * takes the plan off; a grey day says how low you'd go and stays open.
 */
function DaySheet({
  item,
  plan,
  locks,
  today,
  paydays,
  onPick,
  onClose,
}: {
  item: ForecastItem;
  plan: PaymentPlan;
  locks: Locks;
  today: string;
  paydays: string[];
  onPick: (date: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
    };
  }, []);

  const day = (date: string) => (date === today ? "Today" : formatShortDay(date, today));
  const cells = Array.from({ length: daysBetween(today, item.dueOn) + 1 }, (_, i) =>
    addDays(today, i),
  );
  const checkOf = (date: string) => checkDay(item, date, plan, locks, today);
  const pickedCheck = picked ? checkOf(picked) : null;

  return (
    <dialog
      ref={ref}
      aria-label={`Pick a day to pay ${item.name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-[28px] bg-mint p-0 text-left text-ink backdrop:bg-scrim/50 lg:m-auto lg:max-w-[440px] lg:rounded-[28px] lg:shadow-[0_24px_60px_rgba(18,48,42,0.35)]"
    >
      <div className="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate font-display text-xl font-semibold">{item.name}</h2>
            <p className="text-[15px] text-muted">
              <strong className="text-ink">
                {formatPeso(item.amount!)}
                {item.estimate && " est."}
              </strong>{" "}
              · due {day(item.dueOn)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1 rounded-[20px] bg-card p-3">
          <div className="grid grid-cols-7 gap-1" aria-hidden="true">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="text-center text-xs font-bold text-muted">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: weekdayOf(today) }, (_, i) => (
              <span key={`lead-${i}`} />
            ))}
            {cells.map((date) => {
              const check = checkOf(date);
              const due = date === item.dueOn;
              const mine = locks[item.key] === date;
              const payday = paydays.includes(date);
              const showMonth = date === today || date.endsWith("-01");
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => {
                    if (!check.safe) return setPicked(date);
                    onPick(due || mine ? null : date);
                  }}
                  aria-label={`${formatLongDay(date)}${due ? ", due" : ""}${payday ? ", payday" : ""}${mine ? ", planned" : check.safe ? "" : ", not safe"}`}
                  aria-pressed={mine}
                  className={`relative flex h-11 flex-col items-center justify-center rounded-[10px] border-2 text-[13px] ${
                    mine
                      ? "bg-sea font-extrabold text-white"
                      : check.safe
                        ? "bg-card hover:bg-sea-tint"
                        : "bg-line-soft text-muted"
                  } ${due ? "border-coral" : "border-transparent"} ${picked === date ? "ring-2 ring-ink ring-offset-1 ring-offset-card" : ""} ${
                    date === today ? "font-extrabold underline" : ""
                  }`}
                >
                  {showMonth && (
                    <span
                      className={`text-[10px] leading-none ${mine ? "text-sea-text" : "text-muted"}`}
                    >
                      {MONTH.format(Date.parse(`${date}T00:00:00Z`))}
                    </span>
                  )}
                  {Number(date.slice(8))}
                  {payday && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-1 h-[3px] w-3.5 rounded-full bg-sun"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <p aria-live="polite" className="min-h-5 text-[13px] font-bold text-coral-text">
          {pickedCheck &&
            picked &&
            pickedCheck.low !== null &&
            `${day(picked)} · drops to ${formatPeso(pickedCheck.low)} on ${day(pickedCheck.lowOn!)}`}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3.5 w-3.5 rounded bg-line-soft" />
            Not safe
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3.5 w-3.5 rounded border-2 border-coral" />
            Due
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3.5 w-3.5 rounded bg-sea" />
            Planned
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-[3px] w-3.5 rounded-full bg-sun" />
            Payday
          </span>
        </div>
      </div>
    </dialog>
  );
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The month at a glance: paydays, the days you planned payments for, and
 * what's due. Tap a day to see what's on it.
 */
function MonthView({
  today,
  last,
  candidates,
  locks,
  pays,
}: {
  today: string;
  /** The plan's last day: the last month you can go to. */
  last: string;
  candidates: ForecastItem[];
  locks: Locks;
  /** Paydays not received yet, from today. */
  pays: ForecastItem[];
}) {
  const first = today.slice(0, 7);
  const [month, setMonth] = useState(first);
  const [tapped, setTapped] = useState<string | null>(null);

  const on = (date: string) => ({
    pays: pays.filter((p) => p.dueOn === date),
    planned: candidates.filter((c) => locks[c.key] === date),
    due: candidates.filter((c) => !locks[c.key] && c.dueOn === date),
  });
  // Until you tap a day: the next one with something on it.
  const next = [...pays.map((p) => p.dueOn), ...candidates.map((c) => locks[c.key] ?? c.dueOn)]
    .filter((d) => d >= today)
    .sort()[0];
  const selected = tapped ?? next ?? today;
  const picked = on(selected);
  const out = roundCents([...picked.planned, ...picked.due].reduce((sum, c) => sum + c.amount!, 0));
  const nothing = !picked.pays.length && !picked.planned.length && !picked.due.length;
  // The month's payments, each on its planned day or else its due day.
  const inMonth = candidates.filter((c) => (locks[c.key] ?? c.dueOn).startsWith(month));
  const monthTotal = roundCents(inMonth.reduce((sum, c) => sum + c.amount!, 0));

  return (
    <section aria-label="Month" className="flex flex-col gap-2 rounded-[20px] bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          disabled={month <= first}
          aria-label="Previous month"
          className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-line-soft disabled:opacity-30"
        >
          <ChevronIcon direction="left" size={18} />
        </button>
        <span className="flex flex-col items-center">
          <h2 className="font-display text-[17px] font-semibold">
            {MONTH_YEAR.format(Date.parse(`${month}-01T00:00:00Z`))}
          </h2>
          <span className="text-[13px] font-bold text-muted">
            {inMonth.length
              ? `${inMonth.length} to pay · ${formatPeso(monthTotal)}`
              : "Nothing to pay"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={month >= last.slice(0, 7)}
          aria-label="Next month"
          className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-line-soft disabled:opacity-30"
        >
          <ChevronIcon size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-center text-xs font-bold text-muted">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthGrid(month).map((date, i) => {
          if (!date) return <span key={`lead-${i}`} />;
          const that = on(date);
          const past = date < today;
          // How many payments land on the day, and their total.
          const owing = [...that.planned, ...that.due];
          const sum = roundCents(owing.reduce((total, c) => total + c.amount!, 0));
          return (
            <button
              key={date}
              type="button"
              onClick={() => setTapped(date)}
              aria-pressed={selected === date}
              aria-label={`${formatLongDay(date)}${that.pays.length ? ", payday" : ""}${owing.length ? `, ${owing.length} to pay, ${formatPeso(sum)}` : ""}${that.due.length ? `, ${that.due.length} due` : ""}`}
              className={`relative flex h-12 flex-col items-center justify-center rounded-[10px] border-2 pb-1 text-[13px] leading-tight ${
                that.planned.length
                  ? "bg-sea font-extrabold text-white"
                  : past
                    ? "text-muted opacity-50"
                    : "hover:bg-sea-tint"
              } ${that.due.length ? "border-coral" : "border-transparent"} ${
                selected === date ? "ring-2 ring-ink ring-offset-1 ring-offset-card" : ""
              } ${date === today ? "font-extrabold underline" : ""}`}
            >
              {Number(date.slice(8))}
              {owing.length > 0 && (
                <span className="text-[10px] font-extrabold no-underline">
                  {formatPesoShort(sum)}
                </span>
              )}
              {owing.length > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-extrabold ${
                    that.planned.length ? "bg-ink text-card" : "bg-coral text-white"
                  }`}
                >
                  {owing.length}
                </span>
              )}
              {that.pays.length > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0.5 h-[3px] w-3.5 rounded-full bg-sun"
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-[3px] w-3.5 rounded-full bg-sun" />
          Payday
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3.5 w-3.5 rounded bg-sea" />
          Planned
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3.5 w-3.5 rounded border-2 border-coral" />
          Due
        </span>
      </div>

      <div aria-live="polite" className="flex flex-col border-t border-line-soft px-1 pt-2">
        <span className="font-bold">
          {formatRelativeDay(selected, today)}
          {out > 0 && ` · pay ${formatPeso(out)}`}
        </span>
        {nothing ? (
          <span className="text-[13px] text-muted">Nothing</span>
        ) : (
          <ul className="flex flex-col">
            {picked.pays.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 py-1 text-[15px]">
                <span>{p.name}</span>
                <span className="font-display font-semibold text-sea">
                  {p.amount === null ? "amount not set" : `+${formatPeso(p.amount)}`}
                  {p.estimate && (
                    <span className="font-sans text-xs font-bold text-muted"> est.</span>
                  )}
                </span>
              </li>
            ))}
            {[...picked.planned, ...picked.due].map((c) => (
              <li key={c.key} className="flex items-center gap-3 py-1 text-[15px]">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span
                  className={`rounded-full px-2 text-xs font-extrabold ${locks[c.key] ? "bg-sea text-white" : "bg-coral-tint text-coral-text"}`}
                >
                  {locks[c.key] ? "Planned" : "Due"}
                </span>
                <span className="font-display font-semibold">
                  {formatPeso(c.amount!)}
                  {c.estimate && (
                    <span className="font-sans text-xs font-bold text-muted"> est.</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

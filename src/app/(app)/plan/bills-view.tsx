"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { BILLS_VIEW_KEY, formatPesoShort, parseBillsView, type BillsView, type CalendarDay } from "@/lib/bill-calendar";
import { formatLongDay } from "@/lib/dates";
import { formatPeso } from "@/lib/money";
import { SHORT_WEEKDAYS } from "@/lib/schedule";

// Plan › Bills by payday: List or Calendar, remembered on this device. Both
// views are in the page; the section's data-view shows one of them.

const listeners = new Set<() => void>();
/** This visit's choice, for when storage is blocked. */
let chosen: BillsView | null = null;

function read(): BillsView {
  if (chosen) return chosen;
  try {
    return parseBillsView(localStorage.getItem(BILLS_VIEW_KEY));
  } catch {
    return "list";
  }
}

function choose(view: BillsView) {
  chosen = view;
  try {
    localStorage.setItem(BILLS_VIEW_KEY, view);
  } catch {
    // Storage blocked: still switch for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const OPTIONS: { value: BillsView; label: string }[] = [
  { value: "list", label: "List" },
  { value: "calendar", label: "Calendar" },
];

/**
 * The section around the payday cards, with the List / Calendar switch by
 * its heading. Inside, `group-data-[view=calendar]/bills:` shows the calendar.
 */
export function BillsViewSection({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  // List on the server and during hydration, so nothing mismatches.
  const view = useSyncExternalStore(subscribe, read, () => "list" as const);
  return (
    <div data-view={view} className="group/bills flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{heading}</div>
        <div role="group" aria-label="Show bills as" className="flex shrink-0 gap-1 rounded-full bg-card p-1">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={view === o.value}
              onClick={() => choose(o.value)}
              className={`h-9 rounded-full px-3 text-[13px] ${
                view === o.value ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export type CalendarCell = Omit<CalendarDay, "bills">;

/**
 * The days one pay covers on a calendar: what's due each day, and the
 * payday. Sunday-first, except a week or less (weekly pay), which starts on
 * its first day so it's one row. Tap a day with bills to see them below.
 */
export function BillCalendarView({
  days,
  blanks,
  details,
  late,
  pay,
  weekStart,
}: {
  days: CalendarCell[];
  /** The weekday each row starts on, 0 = Sunday. */
  weekStart: number;
  blanks: number;
  /** The payday's pay, when known. */
  pay: number | null;
  /** The bills due each day, drawn by the page, by date. */
  details: Record<string, ReactNode>;
  /** Bills past their date, drawn by the page, or null. */
  late: ReactNode;
}) {
  const [selected, setSelected] = useState(() => days.find((d) => d.count > 0)?.date ?? null);
  const day = days.find((d) => d.date === selected && d.count > 0);
  return (
    <div className="flex flex-col gap-2.5">
      {late}
      <div className="flex flex-col gap-1">
        <div aria-hidden="true" className="grid grid-cols-7 gap-1 text-center text-xs font-extrabold text-muted sm:gap-1.5">
          {SHORT_WEEKDAYS.map((_, i) => SHORT_WEEKDAYS[(weekStart + i) % 7]).map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <ul className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {Array.from({ length: blanks }, (_, i) => (
            <li key={`blank-${i}`} aria-hidden="true" />
          ))}
          {days.map((d) => {
            const isSelected = d.date === day?.date;
            const share = d.payShare;
            const percent = share === null ? null : Math.round(share * 100);
            // Pay is green, bills are yellow; a payday with bills is split by how big each is.
            const tone = share === null ? "bg-mint text-muted" : share === 1 ? "bg-sea-tint" : share === 0 ? "bg-sun-tint" : "";
            const split =
              share !== null && share > 0 && share < 1
                ? { background: `linear-gradient(to right, var(--color-sea-tint) ${percent}%, var(--color-sun-tint) ${percent}%)` }
                : undefined;
            const label = [
              formatLongDay(d.date),
              d.today && "today",
              d.payday && (pay === null ? "payday" : `payday, ${formatPeso(pay)} pay`),
              d.count ? `${d.count} ${d.count === 1 ? "bill" : "bills"}, ${formatPeso(d.total)}` : "nothing due",
              d.payday && d.count > 0 && `${percent}% pay, ${100 - percent!}% bills`,
            ]
              .filter(Boolean)
              .join(", ");
            const body = (
              <>
                <span className="flex items-baseline gap-1 leading-none">
                  <span className="text-sm font-extrabold sm:text-[15px]">{d.dayOfMonth}</span>
                  {d.showMonth && <span className="text-[10px] font-extrabold uppercase text-muted">{MONTH.format(new Date(d.date))}</span>}
                </span>
                {d.payday && <span className="text-[11px] font-extrabold leading-tight text-sea-dark">Pay</span>}
                {d.count > 0 && (
                  <>
                    <span className="text-[11px] font-extrabold leading-tight sm:text-xs">{formatPesoShort(d.total)}</span>
                    <span className="hidden text-[11px] leading-tight text-muted sm:block">
                      {d.count} {d.count === 1 ? "bill" : "bills"}
                    </span>
                  </>
                )}
                {percent !== null && (
                  <span
                    aria-hidden="true"
                    className="mt-auto h-1 w-full rounded-full"
                    style={{ background: `linear-gradient(to right, var(--color-sea) ${percent}%, var(--color-sun) ${percent}%)` }}
                  />
                )}
              </>
            );
            const cell = `flex h-full min-h-14 w-full flex-col items-start gap-0.5 rounded-xl p-1.5 text-left sm:min-h-16 sm:p-2 ${tone} ${
              d.today ? "border-2 border-dashed border-ink" : ""
            }`;
            return (
              <li key={d.date}>
                {d.count > 0 ? (
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={label}
                    onClick={() => setSelected(d.date)}
                    style={split}
                    className={`${cell} hover:ring-2 hover:ring-ink/30 ${isSelected ? "ring-2 ring-ink" : ""}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div aria-label={label} role="img" style={split} className={cell}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs font-bold text-muted">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-sea" />Pay</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-sun" />Bills due</span>
          {days.some((d) => d.payday && d.count > 0) && (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-6 rounded" style={{ background: "linear-gradient(to right, var(--color-sea) 50%, var(--color-sun) 50%)" }} />
              Both, by how big each is
            </span>
          )}
          {days.some((d) => d.today) && (
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border-2 border-dashed border-ink" />Today</span>
          )}
        </div>
      </div>
      <div aria-live="polite" className="flex flex-col gap-1">
        {day ? (
          <>
            <h4 className="flex justify-between gap-3 text-[13px] font-extrabold text-muted">
              <span>
                Due {formatLongDay(day.date)}
                {day.payday && " · payday"}
              </span>
              <span>{formatPeso(day.total)}</span>
            </h4>
            {day.payday && pay !== null && day.payShare !== null && (
              <p className="text-[13px] text-muted">
                <strong className="text-sea-dark">{formatPeso(pay)} pay</strong> comes in the same day:{" "}
                {Math.round(day.payShare * 100)}% pay, {100 - Math.round(day.payShare * 100)}% bills.
              </p>
            )}
            {details[day.date]}
          </>
        ) : (
          <p className="text-[13px] text-muted">Nothing due on these days.</p>
        )}
      </div>
    </div>
  );
}

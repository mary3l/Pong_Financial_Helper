import { addDays, weekdayOf } from "@/lib/dates";
import type { ForecastItem } from "@/lib/forecast";
import { roundCents } from "@/lib/money";
import { groupByPayee, type PayTo } from "@/lib/pay-periods";

// Plan › Bills by payday as a calendar: the days one pay covers, each bill on
// the day it's due. Pure, so it's easy to test; the page draws it.

export type BillsView = "list" | "calendar";

/** Where this device remembers List or Calendar. */
export const BILLS_VIEW_KEY = "bills-by-payday-view";

/** A saved choice, or List when there's none (or it's something else). */
export function parseBillsView(value: unknown): BillsView {
  return value === "calendar" ? "calendar" : "list";
}

/** A pay can cover a month and a bit (only the 5th Friday); never draw more than this. */
const MAX_DAYS = 62;

export type CalendarDay = {
  date: string;
  /** 1–31. */
  dayOfMonth: number;
  /** The first day drawn, or the 1st of a month: label the month on it. */
  showMonth: boolean;
  payday: boolean;
  today: boolean;
  /** Due that day, grouped like the list: each credit line or loan once, each bill on its own. */
  bills: PayTo[];
  total: number;
  /** How many payments are due that day. */
  count: number;
  /**
   * How much of the day is pay, 0–1, for coloring it: 1 for payday alone, 0
   * for bills alone, pay ÷ (pay + bills) when both. Null when it's neither.
   */
  payShare: number | null;
};

/**
 * Pay against what's due the same day: the bigger the bills, the smaller the
 * pay's share. Half each when the pay isn't known.
 */
export function payShare(pay: number | null, bills: number): number {
  if (bills <= 0) return 1;
  if (pay === null) return 0.5;
  if (pay <= 0) return 0;
  return pay / (pay + bills);
}

export type BillCalendar = {
  /**
   * The weekday the calendar's weeks start on, 0 = Sunday. A week or less
   * (weekly pay) starts on its first day, so it's one row; longer ones start
   * on Sunday.
   */
  weekStart: number;
  /** Empty cells before the first day. */
  blanks: number;
  days: CalendarDay[];
  /** Bills already past their date (only before the first payday): they don't fit on a day here. */
  late: PayTo[];
  lateTotal: number;
};

const total = (groups: PayTo[]) => roundCents(groups.reduce((sum, g) => sum + g.total, 0));

/** Every day from `from` to `to`, with the bills due on it. */
export function billCalendar({
  from,
  to,
  payday,
  pay = null,
  bills,
  today,
  lenderName,
}: {
  from: string;
  to: string;
  /** The payday that starts these days, or null before the first one. */
  payday: string | null;
  /** That payday's pay, when known. */
  pay?: number | null;
  bills: ForecastItem[];
  today: string;
  lenderName: (id: string) => string | undefined;
}): BillCalendar {
  const byDay = new Map<string, ForecastItem[]>();
  const late: ForecastItem[] = [];
  for (const b of bills) {
    if (b.dueOn < from) late.push(b);
    else if (b.dueOn <= to) byDay.set(b.dueOn, [...(byDay.get(b.dueOn) ?? []), b]);
  }

  const days: CalendarDay[] = [];
  for (let date = from; date <= to && days.length < MAX_DAYS; date = addDays(date, 1)) {
    const due = byDay.get(date) ?? [];
    const groups = groupByPayee(due, lenderName, today);
    const dayOfMonth = Number(date.slice(8));
    const isPayday = date === payday;
    const dayTotal = total(groups);
    days.push({
      date,
      dayOfMonth,
      showMonth: days.length === 0 || dayOfMonth === 1,
      payday: isPayday,
      today: date === today,
      bills: groups,
      total: dayTotal,
      count: due.length,
      payShare: isPayday ? payShare(pay, dayTotal) : due.length ? 0 : null,
    });
  }

  const lateGroups = groupByPayee(late, lenderName, today);
  const first = days.length ? weekdayOf(from) : 0;
  const weekStart = days.length <= 7 ? first : 0;
  return { weekStart, blanks: (first - weekStart + 7) % 7, days, late: lateGroups, lateTotal: total(lateGroups) };
}

/** A peso amount short enough for a calendar day on a phone: "₱750", "₱4.5k", "₱17k", "₱1.2M". */
export function formatPesoShort(value: number): string {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));
  if (Math.round(abs) < 1000) return `${sign}₱${Math.round(abs)}`;
  if (abs < 9950) return `${sign}₱${trim(abs / 1000, 1)}k`;
  if (Math.round(abs / 1000) < 1000) return `${sign}₱${Math.round(abs / 1000)}k`;
  return `${sign}₱${trim(abs / 1_000_000, 1)}M`;
}

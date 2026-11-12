import { addDays, dateInMonth, weekdayOf } from "@/lib/dates";
import { MAX_AMOUNT, roundCents } from "@/lib/money";

// Payday and bill schedules (recurring_items). See 0002_recurring_items.sql,
// for paydays that differ 0022_payday_amounts.sql, and for pay every work
// day 0023_daily_pay.sql.

/** "daily" is pay handed over every work day: paydays only. */
export type Frequency = "daily" | "weekly" | "monthly" | "twice_monthly";

export type Schedule = {
  frequency: Frequency;
  /** Weekday 0–6 for weekly (daily: the first day you're paid), else a day of the month. */
  day1: number;
  /** Second day of the month for twice_monthly. */
  day2: number | null;
  /**
   * Weekly paydays only: the weeks of the month that pay, 1–5 (2 is the
   * second Friday of the month). Missing or null: every week.
   */
  weeks?: readonly number[] | null;
  /**
   * Daily paydays only: the weekdays you're handed your pay, 0 (Sunday) to
   * 6, in order. Missing or null: every day.
   */
  weekdays?: readonly number[] | null;
  /**
   * Paydays only: what each payday brings when they differ. Weekly: five,
   * one per week of the month. Twice a month: two, for day1 and day2. A null
   * in it, or no list at all, uses the payday's own amount.
   */
  amounts?: readonly (number | null)[] | null;
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weeks of the month a weekly payday can fall in: the 1st to the 5th Friday. */
export const WEEKS_OF_MONTH = [1, 2, 3, 4, 5] as const;

/**
 * The longest a schedule can go between two dates: a payday on the 5th
 * Friday only comes a few times a year (Oct 30, then Jan 29). Every other
 * schedule repeats within 35 days.
 */
export const MAX_GAP_DAYS = 125;

/** How many paydays a schedule has its own amount for: one per week of the month, or one per day. */
export function slotCount(frequency: Frequency): number {
  return frequency === "weekly" ? WEEKS_OF_MONTH.length : frequency === "twice_monthly" ? 2 : 1;
}

/** Which week of its month `date` is in: 1 for the 1st–7th, up to 5 for the 29th–31st. */
export function weekOfMonth(date: string): number {
  return Math.ceil(Number(date.slice(8, 10)) / 7);
}

function validWeeks(weeks: Schedule["weeks"]): boolean {
  if (weeks == null) return true;
  return (
    Array.isArray(weeks) &&
    // At least one of the 1st to 4th: the 5th alone comes only a few times a year.
    weeks.some((w) => w <= 4) &&
    weeks.every((w, i) => Number.isInteger(w) && w >= 1 && w <= 5 && (i === 0 || w > weeks[i - 1]))
  );
}

function validWeekdays(weekdays: Schedule["weekdays"]): boolean {
  if (weekdays == null) return true;
  return (
    Array.isArray(weekdays) &&
    weekdays.length >= 1 &&
    weekdays.every((w, i) => Number.isInteger(w) && w >= 0 && w <= 6 && (i === 0 || w > weekdays[i - 1]))
  );
}

function validAmounts(s: Schedule): boolean {
  if (s.amounts == null) return true;
  return (
    Array.isArray(s.amounts) &&
    (s.frequency === "weekly" || s.frequency === "twice_monthly") &&
    s.amounts.length === slotCount(s.frequency) &&
    s.amounts.every((a) => a === null || (typeof a === "number" && a > 0 && a <= MAX_AMOUNT))
  );
}

export function isValidSchedule(s: Schedule): boolean {
  const day = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 31;
  if (s.frequency !== "weekly" && s.weeks != null) return false;
  if (s.frequency !== "daily" && s.weekdays != null) return false;
  if (!validWeeks(s.weeks) || !validWeekdays(s.weekdays) || !validAmounts(s)) return false;
  if (s.frequency === "weekly" || s.frequency === "daily") {
    return Number.isInteger(s.day1) && s.day1 >= 0 && s.day1 <= 6 && s.day2 === null;
  }
  if (s.frequency === "monthly") return day(s.day1) && s.day2 === null;
  if (s.frequency === "twice_monthly") return day(s.day1) && day(s.day2) && s.day1 < s.day2!;
  return false;
}

/** Every date the schedule falls on, from `from` up to but not including `until`. */
export function occurrences(s: Schedule, from: string, until: string): string[] {
  const dates: string[] = [];
  if (from >= until) return dates;

  if (s.frequency === "daily") {
    const weekdays = s.weekdays?.length ? s.weekdays : null;
    for (let d = from; d < until; d = addDays(d, 1)) if (!weekdays || weekdays.includes(weekdayOf(d))) dates.push(d);
    return dates;
  }

  if (s.frequency === "weekly") {
    const weeks = s.weeks?.length ? s.weeks : null;
    let d = addDays(from, (s.day1 - weekdayOf(from) + 7) % 7);
    while (d < until) {
      if (!weeks || weeks.includes(weekOfMonth(d))) dates.push(d);
      d = addDays(d, 7);
    }
    return dates;
  }

  const days = s.frequency === "twice_monthly" ? [s.day1, s.day2!] : [s.day1];
  let [year, month] = from.split("-").map(Number);
  for (;;) {
    for (const day of days) {
      const d = dateInMonth(year, month, day);
      if (d >= until) return dates;
      if (d >= from) dates.push(d);
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

/** The first date strictly after `date`. */
export function nextOccurrence(s: Schedule, date: string): string {
  return occurrences(s, addDays(date, 1), addDays(date, MAX_GAP_DAYS + 1))[0];
}

/** The last date strictly before `date`. */
export function previousOccurrence(s: Schedule, date: string): string | undefined {
  return occurrences(s, addDays(date, -MAX_GAP_DAYS - 1), date).at(-1);
}

/** Which of the schedule's amounts a payday on `date` uses: its week of the month, or its day. */
export function slotOf(s: Schedule, date: string): number {
  if (s.frequency === "weekly") return weekOfMonth(date) - 1;
  if (s.frequency === "twice_monthly") {
    const [y, m] = date.split("-").map(Number);
    return dateInMonth(y, m, s.day1) === date ? 0 : 1;
  }
  return 0;
}

/** What a payday on `date` brings: its own amount if it has one, else the payday's amount. */
export function amountOn(s: Schedule & { amount: number | null }, date: string): number | null {
  return s.amounts?.[slotOf(s, date)] ?? s.amount;
}

/** True when the paydays have amounts of their own (they aren't all the same). */
export function hasOwnAmounts(s: Pick<Schedule, "amounts">): boolean {
  return Boolean(s.amounts?.some((a) => a !== null));
}

/**
 * Pay in a typical month: weekly pay 52 ÷ 12 times (the 5th week counts a
 * third of the time), twice-a-month pay twice. Null when no amount is known.
 */
export function payPerMonth(s: Schedule & { amount: number | null }): number | null {
  if (s.frequency === "monthly") return s.amount;
  if (s.frequency === "daily") {
    return s.amount === null ? null : roundCents((s.amount * (s.weekdays?.length || 7) * 52) / 12);
  }
  const slots =
    s.frequency === "twice_monthly"
      ? [0, 1].map((i) => ({ i, times: 1 }))
      : (s.weeks?.length ? s.weeks : WEEKS_OF_MONTH).map((w) => ({ i: w - 1, times: w === 5 ? 52 / 12 - 4 : 1 }));
  let total = 0;
  for (const { i, times } of slots) {
    const amount = s.amounts?.[i] ?? s.amount;
    if (amount === null) return null;
    total += amount * times;
  }
  return roundCents(total);
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Mon–Fri", "Mon, Wed & Fri", "Every day". */
export function weekdaysText(weekdays: readonly number[] | null | undefined): string {
  const days = weekdays?.length ? [...weekdays].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
  if (days.length === 7) return "Every day";
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive && days.length >= 3) return `${SHORT_WEEKDAYS[days[0]]}–${SHORT_WEEKDAYS[days.at(-1)!]}`;
  const names = days.map((d) => SHORT_WEEKDAYS[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0];
}

/** "Every work day, Mon–Fri", "Every Friday", "1st & 3rd Friday", "Every 5th", "Every 15th & 30th" */
export function describeSchedule(s: Schedule): string {
  if (s.frequency === "daily") {
    const days = weekdaysText(s.weekdays);
    return days === "Every day" ? "Every day" : `Every work day, ${days}`;
  }
  if (s.frequency === "weekly") {
    const weeks = s.weeks?.length && s.weeks.length < WEEKS_OF_MONTH.length ? s.weeks : null;
    if (!weeks) return `Every ${WEEKDAYS[s.day1]}`;
    const list = weeks.map(ordinal);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} & ${list.at(-1)}` : list[0];
    return `${joined} ${WEEKDAYS[s.day1]}`;
  }
  if (s.frequency === "monthly") return `Every ${ordinal(s.day1)}`;
  return `Every ${ordinal(s.day1)} & ${ordinal(s.day2!)}`;
}

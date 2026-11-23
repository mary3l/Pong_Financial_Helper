// Dates are "YYYY-MM-DD" strings, the same shape as Postgres date columns,
// and "today" is always Philippine time. Arithmetic runs in UTC so a time
// zone offset can never shift a day.

export const APP_TIME_ZONE = "Asia/Manila";

const DAY_MS = 86_400_000;

export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromMs(toMs(value)) === value
  );
}

export function addDays(date: string, days: number): string {
  return fromMs(toMs(date) + days * DAY_MS);
}

/** Whole days from `a` to `b`; positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** `month` is 1–12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(toMs(date)).getUTCDay();
}

/** A day in a month, moved back to the month's last day if it's too short. */
export function dateInMonth(year: number, month: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function format(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(toMs(date));
}

/** "November 2026" */
export function formatMonth(date: string): string {
  return format(date, { month: "long", year: "numeric" });
}

/** "Mon, Nov 2" */
export function formatLongDay(date: string): string {
  return format(date, { weekday: "short", month: "short", day: "numeric" });
}

/** "Nov 2", or "Nov 2, 2025" outside the current year. */
export function formatShortDay(date: string, todayStr = today()): string {
  return date.slice(0, 4) === todayStr.slice(0, 4)
    ? format(date, { month: "short", day: "numeric" })
    : format(date, { month: "short", day: "numeric", year: "numeric" });
}

/** "Today", "Yesterday" or "Nov 2". */
export function formatRelativeDay(date: string, todayStr = today()): string {
  const diff = daysBetween(date, todayStr);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  return formatShortDay(date, todayStr);
}

/** "3:42 PM" in Philippine time, from an ISO timestamp; "" if there's none. */
export function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "";
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

/** "15:42" in Philippine time, from a Date or an ISO timestamp. */
export function clockOf(when: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(typeof when === "string" ? new Date(when) : when);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** "15:42" (24-hour, as a time input gives it). */
export function isValidClock(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** "15:42" → "3:42 PM". */
export function formatClock(clock: string): string {
  const [h, m] = clock.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The time a transaction shows: the one picked in Add / Edit, else when it was logged. */
export function transactionTime(txn: {
  occurredTime?: string | null;
  createdAt: string | null;
}): string {
  return txn.occurredTime ? formatClock(txn.occurredTime) : formatTime(txn.createdAt);
}

// Activity is shown per kinsenas: the 1st–15th and the 16th–end of month.
export type Period = { start: string; end: string };

export function periodContaining(date: string): Period {
  const [y, m, d] = date.split("-").map(Number);
  return d <= 15
    ? { start: dateInMonth(y, m, 1), end: dateInMonth(y, m, 15) }
    : { start: dateInMonth(y, m, 16), end: dateInMonth(y, m, 31) };
}

/** The whole month: two kinsenas. */
export function monthContaining(date: string): Period {
  const [y, m] = date.split("-").map(Number);
  return { start: dateInMonth(y, m, 1), end: dateInMonth(y, m, 31) };
}

export function previousPeriod(period: Period): Period {
  return periodContaining(addDays(period.start, -1));
}

export function nextPeriod(period: Period): Period {
  return periodContaining(addDays(period.end, 1));
}

/** "Nov 1 – 15" */
export function formatPeriod(period: Period, todayStr = today()): string {
  return `${formatShortDay(period.start, todayStr)} – ${Number(period.end.slice(8))}`;
}

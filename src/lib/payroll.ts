import { addDays, dateInMonth, formatShortDay, weekdayOf, type Period } from "@/lib/dates";
import { roundCents } from "@/lib/money";
import { MAX_GAP_DAYS, WEEKDAYS, occurrences, previousOccurrence, type Frequency, type Schedule } from "@/lib/schedule";

// Payroll calculator (see 0013_payroll.sql). Pay per day: your daily rate
// times the days you worked in a cutoff (no work, no pay). Pay per month
// (0023): the cutoff's share of your monthly pay, minus each work day you
// missed. Either way minus late minutes, plus overtime. Nobody deducts
// anything from it: SSS, PhilHealth, Pag-IBIG and the 8% income tax are
// bills you pay yourself, so they live in Money going out.
//
// Cutoffs follow how often you're paid (your payday):
//
//   Every work day  each day is its own cutoff, paid that day; a day worked
//                   that isn't a payday goes with the next payday.
//   Weekly          a week, starting on the weekday you set: Monday (Mon–Sun).
//   Twice a month   two cutoffs, starting on the days you set: the 1st and
//                   16th (a kinsena) unless your company uses others, like the
//                   3rd and 18th (3–17 and 18–2).
//   Monthly         one, starting on the day you set: the 1st (1st–end).
//
// Each is paid on the first payday after it ends: with paydays on the 15th
// and 30th, 1–15 is paid on the 30th and 16–31 on the next 15th; 3–17 on the
// 30th and 18–2 on the 15th. A payday pays every cutoff that ended since the
// payday before it (two weeks, when only every other Friday pays).
//
// One cutoff can be on other dates than usual (CutoffChange): the cutoffs
// either side move to meet it, so no day is paid twice or never.
//
// Pure, so the server and the browser share it.

/**
 * Contribution and tax rates. Update these when SSS, PhilHealth, Pag-IBIG or
 * the BIR change them.
 */
export const RATES = {
  /** Working days in a month, for the monthly pay contributions are based on. */
  workDaysPerMonth: 22,
  /** Working days in a week, for a typical weekly payday. */
  workDaysPerWeek: 5,
  /** SSS, self-employed or voluntary (2025): the full 15% of your salary credit. */
  sss: { rate: 0.15, minCredit: 5000, maxCredit: 35000, step: 500 },
  /** PhilHealth, self-paying (2025): the full 5%, with an income floor and ceiling. */
  philhealth: { rate: 0.05, floor: 10000, ceiling: 100000 },
  /** Pag-IBIG, self-employed: both shares, on pay up to ₱10,000. */
  pagibig: { rate: 0.04, lowRate: 0.03, lowUpTo: 1500, maxBase: 10000 },
  /** BIR 8% option: 8% of yearly gross above ₱250,000. */
  tax: { rate: 0.08, exempt: 250000 },
  /** The day of the month the monthly contributions are paid. */
  contributionDay: 30,
} as const;

export type PayrollSettings = {
  dailyRate: number;
  hoursPerDay: number;
  /** "08:00": every minute after this on a day you worked is deducted. */
  startTime: string;
  /** 1 pays overtime at your hourly rate; 1.25 adds a quarter. */
  overtimeRate: number;
  /** What contributions are based on. Null: daily rate × 22 days. */
  monthlyBase: number | null;
  /** Days before this count as not working (tax only counts pay from here). */
  startedOn: string | null;
  paySss: boolean;
  payPhilhealth: boolean;
  payPagibig: boolean;
  payTax: boolean;
  /**
   * What your company actually takes for each, when it isn't the standard
   * rate (say, while you're not yet regular). Null: calculated.
   */
  sssAmount: number | null;
  philhealthAmount: number | null;
  pagibigAmount: number | null;
  /** Twice a month: the days your two cutoffs start (migration 0021). Missing: the 1st and 16th. */
  cutoffDays?: CutoffDays;
  /** Weekly: the weekday a cutoff week starts, 0 (Sunday) to 6 (migration 0022). Missing: Monday. */
  cutoffWeekday?: number;
  /** Monthly: the day a cutoff month starts, 1 to 28 (migration 0022). Missing: the 1st. */
  cutoffMonthDay?: number;
  /** How often you're paid: your payday's schedule, not saved with your pay. Missing: twice a month. */
  frequency?: Frequency;
  /**
   * Your rate is per month (migration 0023): each cutoff's base is its share
   * of it, and dailyRate is it ÷ 22, for days missed, late and overtime.
   * Missing or null: your rate is per day.
   */
  monthlyPay?: number | null;
  /** What a Saturday is (migration 0023). Missing: off. */
  saturday?: WeekendMode;
  /** What a Sunday is (migration 0023). Missing: off. */
  sunday?: WeekendMode;
  /** Cutoffs on other dates than usual (migration 0023), read with your settings. */
  cutoffChanges?: readonly CutoffChange[];
};

/**
 * A weekend day: off, a regular work day (a day's pay, late counts), or
 * overtime (the hours you work, at the overtime rate).
 */
export type WeekendMode = "off" | "regular" | "overtime";

export const WEEKEND_MODES: { value: WeekendMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "regular", label: "Regular day" },
  { value: "overtime", label: "Overtime" },
];

export function isWeekendMode(value: unknown): value is WeekendMode {
  return value === "off" || value === "regular" || value === "overtime";
}

/** One cutoff on other dates than usual, and the day it's paid if that moved too. */
export type CutoffChange = {
  /** The first day it would usually have. */
  usual: string;
  start: string;
  end: string;
  /** Null: the usual payday. */
  paidOn: string | null;
};

/** The two days of the month a cutoff starts, smaller first: [3, 18] is 3–17 and 18–2. */
export type CutoffDays = readonly [number, number];

/** A kinsena: 1–15 and 16–end of month. */
export const KINSENA: CutoffDays = [1, 16];

/** Cutoff start days can be 1 to 28, so every month has them. */
export function isCutoffDays(value: unknown): value is CutoffDays {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((d) => Number.isInteger(d) && d >= 1 && d <= 28) &&
    value[0] < value[1]
  );
}

export function cutoffDaysOf(s: Pick<PayrollSettings, "cutoffDays">): CutoffDays {
  return s.cutoffDays && isCutoffDays(s.cutoffDays) ? s.cutoffDays : KINSENA;
}

/** How your cutoffs run: like your payday. Each can carry cutoffs on other dates. */
export type CutoffRule = (
  | { every: "day" }
  | { every: "week"; weekday: number }
  | { every: "half_month"; days: CutoffDays }
  | { every: "month"; day: number }
) & { changes?: readonly CutoffChange[] };

/** Monday to Sunday. */
export const DEFAULT_CUTOFF_WEEKDAY = 1;

export function isCutoffWeekday(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
}

export function isCutoffMonthDay(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 28;
}

/** Your cutoffs, from how often you're paid and the days you set. */
export function cutoffRuleOf(
  s: Pick<PayrollSettings, "cutoffDays" | "cutoffWeekday" | "cutoffMonthDay" | "frequency" | "cutoffChanges">,
): CutoffRule {
  if (s.frequency === "daily") return { every: "day" };
  const changes = s.cutoffChanges?.length ? { changes: s.cutoffChanges } : {};
  if (s.frequency === "weekly") {
    return { every: "week", weekday: isCutoffWeekday(s.cutoffWeekday) ? s.cutoffWeekday : DEFAULT_CUTOFF_WEEKDAY, ...changes };
  }
  if (s.frequency === "monthly") return { every: "month", day: isCutoffMonthDay(s.cutoffMonthDay) ? s.cutoffMonthDay : 1, ...changes };
  return { every: "half_month", days: cutoffDaysOf(s), ...changes };
}

/** Daily pay is a day per cutoff, so the calculator shows and saves a week at a time. */
export function pageRule(cutoffs: Cutoffs): CutoffRule {
  const rule = ruleOf(cutoffs);
  return rule.every === "day" ? { every: "week", weekday: DEFAULT_CUTOFF_WEEKDAY } : rule;
}

/** Two days of the month (twice-a-month cutoffs), or any rule. */
export type Cutoffs = CutoffDays | CutoffRule;

function ruleOf(cutoffs: Cutoffs): CutoffRule {
  return Array.isArray(cutoffs) ? { every: "half_month", days: cutoffs as CutoffDays } : (cutoffs as CutoffRule);
}

/**
 * The cutoff `date` is in. With [3, 18]: Nov 3–17, Nov 18–Dec 2, or Oct
 * 18–Nov 2 for Nov 1. Weekly from Monday: the Monday to Sunday around it.
 * Monthly from the 1st: its month. Daily: the day. A cutoff on other dates
 * wins, and the ones either side move to meet it.
 */
export function cutoffContaining(date: string, cutoffs: Cutoffs = KINSENA): Period {
  const rule = ruleOf(cutoffs);
  const usual = usualCutoff(date, rule);
  if (!rule.changes?.length || rule.every === "day") return usual;
  const candidates = [usualCutoff(addDays(usual.start, -1), rule), usual, usualCutoff(addDays(usual.end, 1), rule)];
  for (const c of candidates) {
    const moved = withChanges(c, rule);
    if (moved.start <= date && date <= moved.end) return moved;
  }
  return usual;
}

/** A usual cutoff as it is with the changes: its own, or moved to meet the ones either side. */
function withChanges(usual: Period, rule: CutoffRule): Period {
  const changes = rule.changes ?? [];
  const own = changes.find((c) => c.usual === usual.start);
  if (own) return { start: own.start, end: own.end };
  const before = changes.find((c) => c.usual === usualCutoff(addDays(usual.start, -1), rule).start);
  const after = changes.find((c) => c.usual === usualCutoff(addDays(usual.end, 1), rule).start);
  return { start: before ? addDays(before.end, 1) : usual.start, end: after ? addDays(after.start, -1) : usual.end };
}

/** The cutoff as the rule alone has it, before any changes. */
export function usualCutoff(date: string, cutoffs: Cutoffs = KINSENA): Period {
  const rule = ruleOf(cutoffs);
  if (rule.every === "day") return { start: date, end: date };
  if (rule.every === "week") {
    const start = addDays(date, -((weekdayOf(date) - rule.weekday + 7) % 7));
    return { start, end: addDays(start, 6) };
  }
  const [y, m, d] = date.split("-").map(Number);
  const month = (offset: number) => {
    const n = y * 12 + (m - 1) + offset;
    return [Math.floor(n / 12), (n % 12) + 1] as const;
  };
  const on = (offset: number, day: number) => {
    const [yy, mm] = month(offset);
    return dateInMonth(yy, mm, day);
  };
  if (rule.every === "month") {
    const a = rule.day;
    if (d >= a) return { start: on(0, a), end: addDays(on(1, a), -1) };
    return { start: on(-1, a), end: addDays(on(0, a), -1) };
  }
  const [a, b] = rule.days;
  if (d >= b) return { start: on(0, b), end: addDays(on(1, a), -1) };
  if (d >= a) return { start: on(0, a), end: addDays(on(0, b), -1) };
  return { start: on(-1, b), end: addDays(on(0, a), -1) };
}

export function previousCutoff(cutoff: Period, cutoffs: Cutoffs = KINSENA): Period {
  return cutoffContaining(addDays(cutoff.start, -1), cutoffs);
}

export function nextCutoff(cutoff: Period, cutoffs: Cutoffs = KINSENA): Period {
  return cutoffContaining(addDays(cutoff.end, 1), cutoffs);
}

/** The usual cutoff a cutoff on screen stands for: its change's, or the one that moved to it. */
export function usualFor(cutoff: Period, cutoffs: Cutoffs): Period {
  const rule = ruleOf(cutoffs);
  const own = rule.changes?.find((c) => c.start === cutoff.start && c.end === cutoff.end);
  if (own) return usualCutoff(own.usual, rule);
  const first = usualCutoff(cutoff.start, rule);
  for (const u of [first, usualCutoff(addDays(first.end, 1), rule), usualCutoff(cutoff.end, rule)]) {
    const moved = withChanges(u, rule);
    if (moved.start === cutoff.start && moved.end === cutoff.end) return u;
  }
  return first;
}

/** The change that made this cutoff, if it's on other dates than usual. */
export function changeOf(cutoff: Period, cutoffs: Cutoffs): CutoffChange | null {
  return ruleOf(cutoffs).changes?.find((c) => c.start === cutoff.start && c.end === cutoff.end) ?? null;
}

/**
 * Checks a change to the cutoff that usually starts `change.usual`: it must
 * leave the cutoffs either side at least a day, and meet any change next to
 * it. Null when it's fine.
 */
export function cutoffChangeProblem(change: CutoffChange, cutoffs: Cutoffs, today: string): string | null {
  const rule = ruleOf(cutoffs);
  if (rule.every === "day") return "Each day is its own cutoff with daily pay.";
  const usual = usualCutoff(change.usual, rule);
  if (usual.start !== change.usual) return "Pick a cutoff.";
  if (change.end < change.start) return "The cutoff can't end before it starts.";
  const before = usualCutoff(addDays(usual.start, -1), rule);
  const after = usualCutoff(addDays(usual.end, 1), rule);
  if (change.start <= before.start) return `Start it after ${formatShortDay(before.start, today)}: the cutoff before needs a day.`;
  if (change.end >= after.end) return `End it before ${formatShortDay(after.end, today)}: the cutoff after needs a day.`;
  const others = (rule.changes ?? []).filter((c) => c.usual !== change.usual);
  const changedBefore = others.find((c) => c.usual === before.start);
  const changedAfter = others.find((c) => c.usual === after.start);
  if (changedBefore && change.start !== addDays(changedBefore.end, 1)) {
    return `The cutoff before ends ${formatShortDay(changedBefore.end, today)}, so this one starts ${formatShortDay(addDays(changedBefore.end, 1), today)}.`;
  }
  if (changedAfter && change.end !== addDays(changedAfter.start, -1)) {
    return `The cutoff after starts ${formatShortDay(changedAfter.start, today)}, so this one ends ${formatShortDay(addDays(changedAfter.start, -1), today)}.`;
  }
  if (change.paidOn !== null && change.paidOn < change.start) return "It can't be paid before it starts.";
  return null;
}

/** "Nov 3 – 17", or "Nov 18 – Dec 2" across months. */
export function formatCutoff(cutoff: Period, today: string): string {
  const end = cutoff.end.slice(0, 7) === cutoff.start.slice(0, 7) ? String(Number(cutoff.end.slice(8))) : formatShortDay(cutoff.end, today);
  return `${formatShortDay(cutoff.start, today)} – ${end}`;
}

/** "1–15 and 16–end", "3–17 and 18–2". */
export function cutoffDaysText(days: CutoffDays): string {
  const [a, b] = days;
  return `${a}–${b - 1} and ${b}–${a === 1 ? "end" : a - 1}`;
}

/** "1–15 and 16–end", "the 1st to the end of the month", "Monday to Sunday", "each day". */
export function cutoffRuleText(cutoffs: Cutoffs): string {
  const rule = ruleOf(cutoffs);
  if (rule.every === "day") return "each day";
  if (rule.every === "half_month") return cutoffDaysText(rule.days);
  if (rule.every === "week") return `${WEEKDAYS[rule.weekday]} to ${WEEKDAYS[(rule.weekday + 6) % 7]}`;
  return rule.day === 1 ? "the 1st to the end of the month" : `the ${ordinal(rule.day)} to the ${ordinal(rule.day - 1)} of the next month`;
}

/** What each pay covers, in a few words: "cutoffs 3–17 and 18–2", "weeks Monday to Sunday", "each day's pay that day". */
export function coversText(cutoffs: Cutoffs): string {
  const rule = ruleOf(cutoffs);
  if (rule.every === "day") return "each day's pay that day";
  if (rule.every === "week") return `weeks ${cutoffRuleText(rule)}`;
  if (rule.every === "month") return `cutoff ${cutoffRuleText(rule)}`;
  return `cutoffs ${cutoffRuleText(rule)}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export type DayStatus = "worked" | "leave" | "off";
export type LeaveType = "sick" | "personal";

export type PayrollDay = {
  date: string;
  status: DayStatus;
  /** Leave only. */
  leaveType: LeaveType | null;
  /** Leave only: the reason, optional. */
  note: string | null;
  /** Worked only: "08:12". Null means on time. */
  timeIn: string | null;
};

export type OvertimeEntry = {
  date: string;
  /** "17:00" */
  start: string;
  /** "20:00". Earlier than start means past midnight. */
  end: string;
};

export const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: "sick", label: "Sick leave" },
  { value: "personal", label: "Personal leave" },
];

export function isTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h <= 23 && m <= 59;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** "8:00 AM" */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "1h 30m", "45m", "3h" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function hourlyRate(s: Pick<PayrollSettings, "dailyRate" | "hoursPerDay">): number {
  return s.dailyRate / s.hoursPerDay;
}

/** Minutes after the start time, never more than a full day's hours. */
export function minutesLate(timeIn: string | null, s: Pick<PayrollSettings, "startTime" | "hoursPerDay">): number {
  if (!timeIn) return 0;
  return Math.min(s.hoursPerDay * 60, Math.max(0, minutesOf(timeIn) - minutesOf(s.startTime)));
}

/** Length of an overtime entry in minutes; an end before the start runs past midnight. */
export function overtimeMinutes(entry: Pick<OvertimeEntry, "start" | "end">): number {
  const diff = minutesOf(entry.end) - minutesOf(entry.start);
  return diff > 0 ? diff : diff + 24 * 60;
}

/** Every date in a cutoff. */
export function cutoffDates(period: Period): string[] {
  const dates: string[] = [];
  for (let d = period.start; d <= period.end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

type Weekends = Pick<PayrollSettings, "saturday" | "sunday">;

/** What a date is for you: a regular work day, an overtime day (a weekend set so), or off. */
export function dayKind(date: string, weekends: Weekends = {}): WeekendMode {
  const weekday = weekdayOf(date);
  if (weekday === 6) return weekends.saturday ?? "off";
  if (weekday === 0) return weekends.sunday ?? "off";
  return "regular";
}

/** Regular days are worked, other days off, and nothing before you started. */
export function defaultDay(date: string, startedOn: string | null = null, weekends: Weekends = {}): PayrollDay {
  const before = startedOn !== null && date < startedOn;
  const off = before || dayKind(date, weekends) !== "regular";
  return { date, status: off ? "off" : "worked", leaveType: null, note: null, timeIn: null };
}

/** The cutoff's days: saved ones, and the default for any not saved. */
export function daysFor(
  period: Period,
  saved: Map<string, PayrollDay>,
  startedOn: string | null,
  weekends: Weekends = {},
): PayrollDay[] {
  return cutoffDates(period).map((date) => saved.get(date) ?? defaultDay(date, startedOn, weekends));
}

/** Regular work days in a week: Monday to Friday, and a weekend day set as regular. */
export function regularDaysPerWeek(weekends: Weekends): number {
  return 5 + (weekends.saturday === "regular" ? 1 : 0) + (weekends.sunday === "regular" ? 1 : 0);
}

export type CutoffPay = {
  workedDays: number;
  sickDays: number;
  personalDays: number;
  /**
   * Pay per month: the share of it this cutoff gets (0.5 twice a month).
   * Null: pay per day, so the base is days worked × your daily rate.
   */
  share: number | null;
  /** Pay per day: days worked × rate. Pay per month: the share of it. */
  basePay: number;
  /** Pay per month: regular work days you didn't work (leave or off). */
  missedDays: number;
  /** Pay per month: days worked that are usually off (a Sunday you came in), paid a day's rate each. */
  extraDays: number;
  missedDeduction: number;
  lateMinutes: number;
  lateDeduction: number;
  overtimeMinutes: number;
  overtimePay: number;
  /** What lands on payday. Never below 0. */
  total: number;
};

/**
 * The share of your monthly pay one cutoff gets: all of it monthly, half
 * twice a month, 12/52 weekly. Null with daily pay, which is per day worked.
 */
export function shareOf(cutoffs: Cutoffs): number | null {
  const rule = ruleOf(cutoffs);
  return rule.every === "month" ? 1 : rule.every === "half_month" ? 0.5 : rule.every === "week" ? 12 / 52 : null;
}

/**
 * Pay for one cutoff. Per day: days worked × daily rate (no work, no pay).
 * Per month (`share` given and a monthly pay set): that share of it, minus
 * each regular day you didn't work, plus a day's rate for each day you came
 * in that's usually off. Then minus late, plus overtime. Leave is unpaid. A
 * weekend set as overtime only pays its overtime hours.
 */
export function cutoffPay(s: PayrollSettings, days: PayrollDay[], overtime: OvertimeEntry[], share: number | null = null): CutoffPay {
  const counted = days.filter((d) => s.startedOn === null || d.date >= s.startedOn);
  const regular = counted.filter((d) => dayKind(d.date, s) === "regular");
  // A day's pay: any day worked but a weekend set as overtime.
  const worked = counted.filter((d) => d.status === "worked" && dayKind(d.date, s) !== "overtime");
  const lateMinutes = worked.reduce((sum, d) => sum + minutesLate(d.timeIn, s), 0);
  // Overtime counts on any day, a Saturday or holiday included.
  const otMinutes = overtime.reduce((sum, o) => sum + overtimeMinutes(o), 0);
  const perMinute = hourlyRate(s) / 60;
  const monthly = s.monthlyPay && share !== null ? share : null;
  const missedDays = monthly !== null ? regular.filter((d) => d.status !== "worked").length : 0;
  const extraDays = monthly !== null ? worked.length - (regular.length - missedDays) : 0;
  const basePay = roundCents(monthly !== null ? s.monthlyPay! * monthly + extraDays * s.dailyRate : worked.length * s.dailyRate);
  const missedDeduction = roundCents(missedDays * s.dailyRate);
  const lateDeduction = roundCents(lateMinutes * perMinute);
  const overtimePay = roundCents(otMinutes * perMinute * s.overtimeRate);
  return {
    workedDays: worked.length,
    sickDays: days.filter((d) => d.status === "leave" && d.leaveType === "sick").length,
    personalDays: days.filter((d) => d.status === "leave" && d.leaveType === "personal").length,
    share: monthly,
    basePay,
    missedDays,
    extraDays,
    missedDeduction,
    lateMinutes,
    lateDeduction,
    overtimeMinutes: otMinutes,
    overtimePay,
    total: Math.max(0, roundCents(basePay - missedDeduction - lateDeduction + overtimePay)),
  };
}

/** The parts of your pay that can change from one cutoff on. */
export type CutoffRate = Pick<PayrollSettings, "dailyRate" | "hoursPerDay" | "startTime" | "overtimeRate" | "monthlyPay">;

/**
 * Your pay from one cutoff on (a raise, new hours, a new start time), until
 * the next change. Cutoffs before the first change use the rate in your
 * settings. See 0021_payroll_pay_changes.sql.
 */
export type PayChange = CutoffRate & {
  /** The first day of the cutoff it starts with: the 1st or the 16th. */
  from: string;
};

/** Saved days and overtime, ready to look up by date. */
export type PayrollRecords = {
  settings: PayrollSettings;
  days: PayrollDay[];
  overtime: OvertimeEntry[];
  /** Oldest first. Missing or empty: one rate for every cutoff. */
  changes?: PayChange[];
};

export function rateOf(s: CutoffRate): CutoffRate {
  return {
    dailyRate: s.dailyRate,
    hoursPerDay: s.hoursPerDay,
    startTime: s.startTime,
    overtimeRate: s.overtimeRate,
    monthlyPay: s.monthlyPay ?? null,
  };
}

export function sameRate(a: CutoffRate, b: CutoffRate): boolean {
  return (
    a.dailyRate === b.dailyRate &&
    a.hoursPerDay === b.hoursPerDay &&
    a.startTime === b.startTime &&
    a.overtimeRate === b.overtimeRate &&
    (a.monthlyPay ?? null) === (b.monthlyPay ?? null)
  );
}

/** A day's rate from a monthly pay: ÷ 22 work days. */
export function dailyFromMonthly(monthly: number): number {
  return roundCents(monthly / RATES.workDaysPerMonth);
}

/** The change in effect for the cutoff that has `date`, or null for the rate in your settings. */
export function changeFor(records: Pick<PayrollRecords, "settings" | "changes">, date: string): PayChange | null {
  const start = cutoffContaining(date, cutoffRuleOf(records.settings)).start;
  let found: PayChange | null = null;
  for (const c of records.changes ?? []) if (c.from <= start && (!found || c.from > found.from)) found = c;
  return found;
}

/** Your settings with the pay for the cutoff that has `date`. */
export function settingsFor(records: Pick<PayrollRecords, "settings" | "changes">, date: string): PayrollSettings {
  const change = changeFor(records, date);
  return change ? { ...records.settings, ...rateOf(change) } : records.settings;
}

export type CutoffResult = CutoffPay & {
  period: Period;
  /** True while the cutoff isn't saved yet or hasn't ended. */
  estimate: boolean;
};

/** Pay for the cutoff `period`, from saved days or the default work week. */
export function payForCutoff(records: PayrollRecords, period: Period, today: string, index?: RecordIndex): CutoffResult {
  const { byDate, saved } = index ?? indexRecords(records);
  const days = daysFor(period, byDate, records.settings.startedOn, records.settings);
  const overtime = records.overtime.filter((o) => o.date >= period.start && o.date <= period.end);
  const isSaved = cutoffDates(period).some((d) => saved.has(d));
  return {
    ...cutoffPay(settingsFor(records, period.start), days, overtime, shareOf(cutoffRuleOf(records.settings))),
    period,
    estimate: !isSaved || period.end >= today,
  };
}

type RecordIndex = { byDate: Map<string, PayrollDay>; saved: Set<string> };

function indexRecords(records: PayrollRecords): RecordIndex {
  return {
    byDate: new Map(records.days.map((d) => [d.date, d])),
    saved: new Set(records.days.map((d) => d.date)),
  };
}

/**
 * The cutoff a payday pays for: the last one that ended before it. With
 * daily pay, the payday itself.
 */
export function cutoffFor(payday: string, cutoffs: Cutoffs = KINSENA): Period {
  if (ruleOf(cutoffs).every === "day") return { start: payday, end: payday };
  let cutoff = cutoffContaining(payday, cutoffs);
  while (cutoff.end >= payday) cutoff = previousCutoff(cutoff, cutoffs);
  return cutoff;
}

/**
 * Every cutoff a payday pays for, oldest first: the ones that ended since
 * the payday before it. Usually one; two weeks when only every other Friday
 * pays; with daily pay, the day and any days since the last payday (a
 * Sunday worked goes with Monday).
 */
export function cutoffsPaidOn(payday: string, schedule: Schedule, cutoffs: Cutoffs = KINSENA): Period[] {
  const daily = ruleOf(cutoffs).every === "day";
  const last = cutoffFor(payday, cutoffs);
  const before = previousOccurrence(schedule, payday);
  const paid = [last];
  if (!before) return paid;
  // Daily: the days after the last payday. Others: cutoffs that ended on or after it.
  const stillPaid = (c: Period) => (daily ? c.end > before : c.end >= before);
  for (let c = previousCutoff(last, cutoffs); stillPaid(c) && paid.length < 10; c = previousCutoff(c, cutoffs)) {
    paid.unshift(c);
  }
  return paid;
}

/**
 * The payday that pays for `cutoff`: the day it moved to, or the first
 * payday after it ends (daily pay: on or after).
 */
export function paydayFor(cutoff: Period, schedule: Schedule, cutoffs?: Cutoffs): string {
  const moved = cutoffs ? changeOf(cutoff, cutoffs)?.paidOn : null;
  if (moved) return moved;
  const after = cutoffs && ruleOf(cutoffs).every === "day" ? cutoff.end : addDays(cutoff.end, 1);
  return occurrences(schedule, after, addDays(after, MAX_GAP_DAYS + 1))[0] ?? nextCutoff(cutoff).end;
}

export type PaydayAmount = {
  amount: number;
  estimate: boolean;
  /** The day it's actually paid, when a cutoff's payday moved. */
  paidOn?: string;
};

/**
 * Payday amounts by their usual date, for the forecast, from `from` up to
 * but not including `until`.
 */
export function paydayAmounts(
  records: PayrollRecords,
  schedule: Schedule,
  from: string,
  until: string,
  today: string,
): Record<string, PaydayAmount> {
  const index = indexRecords(records);
  const rule = cutoffRuleOf(records.settings);
  const out: Record<string, PaydayAmount> = {};
  for (const date of occurrences(schedule, from, until)) {
    const cutoffs = cutoffsPaidOn(date, schedule, rule);
    const pays = cutoffs.map((c) => payForCutoff(records, c, today, index));
    const moved = cutoffs.map((c) => changeOf(c, rule)?.paidOn).find(Boolean);
    out[date] = {
      amount: roundCents(pays.reduce((sum, p) => sum + p.total, 0)),
      estimate: pays.some((p) => p.estimate),
      ...(moved && moved !== date ? { paidOn: moved } : {}),
    };
  }
  return out;
}

/**
 * A typical payday, saved as the payday's amount. Per month: its share.
 * Per day: the regular days in a week, half a month or a month.
 */
export function typicalCutoffPay(s: PayrollSettings): number {
  const rule = cutoffRuleOf(s);
  if (rule.every === "day") return s.dailyRate;
  const share = shareOf(rule)!;
  if (s.monthlyPay) return roundCents(s.monthlyPay * share);
  const perWeek = regularDaysPerWeek(s);
  // A week is its work days; a month 22 of them (more with a regular Saturday).
  const days = rule.every === "week" ? perWeek : RATES.workDaysPerMonth * (perWeek / RATES.workDaysPerWeek) * share;
  return roundCents(s.dailyRate * days);
}

/** What contributions are based on: your monthly pay. */
export function monthlyBase(s: PayrollSettings): number {
  return s.monthlyBase ?? s.monthlyPay ?? roundCents(s.dailyRate * RATES.workDaysPerMonth);
}

/** SSS monthly salary credit: your pay rounded to the nearest ₱500, within the limits. */
export function sssSalaryCredit(monthly: number): number {
  const { minCredit, maxCredit, step } = RATES.sss;
  const credit = step * Math.floor((monthly + step / 2) / step);
  return Math.min(maxCredit, Math.max(minCredit, credit));
}

export function sssContribution(monthly: number): number {
  return roundCents(sssSalaryCredit(monthly) * RATES.sss.rate);
}

export function philhealthContribution(monthly: number): number {
  const { rate, floor, ceiling } = RATES.philhealth;
  return roundCents(Math.min(ceiling, Math.max(floor, monthly)) * rate);
}

export function pagibigContribution(monthly: number): number {
  const { rate, lowRate, lowUpTo, maxBase } = RATES.pagibig;
  return roundCents(Math.min(maxBase, monthly) * (monthly <= lowUpTo ? lowRate : rate));
}

export type ContributionKey = "sss" | "philhealth" | "pagibig";

export type Contribution = {
  key: ContributionKey;
  name: string;
  amount: number;
  /** True when it's the amount you entered, not the calculated one. */
  custom: boolean;
};

/** Each contribution's amount from the rates, before any amount you entered. */
export function calculatedContributions(s: PayrollSettings): Record<ContributionKey, number> {
  const base = monthlyBase(s);
  return {
    sss: sssContribution(base),
    philhealth: philhealthContribution(base),
    pagibig: pagibigContribution(base),
  };
}

/** The monthly contributions you've chosen to pay, due on the 30th. Your own amounts win. */
export function contributions(s: PayrollSettings): Contribution[] {
  const calculated = calculatedContributions(s);
  const all: { key: ContributionKey; name: string; own: number | null; on: boolean }[] = [
    { key: "sss", name: "SSS contribution", own: s.sssAmount, on: s.paySss },
    { key: "philhealth", name: "PhilHealth contribution", own: s.philhealthAmount, on: s.payPhilhealth },
    { key: "pagibig", name: "Pag-IBIG contribution", own: s.pagibigAmount, on: s.payPagibig },
  ];
  return all
    .map(({ key, name, own, on }) => ({ key, name, on, custom: own !== null, amount: own ?? calculated[key] }))
    .filter((c) => c.on && c.amount > 0)
    .map(({ key, name, amount, custom }) => ({ key, name, amount, custom }));
}

/** 8% income tax on everything you've earned in the year so far, above ₱250,000. */
export function taxOnGross(cumulative: number): number {
  return roundCents(Math.max(0, cumulative - RATES.tax.exempt) * RATES.tax.rate);
}

export type TaxPayment = {
  /** "2026-Q3"; Q4 is the annual return. */
  key: string;
  name: string;
  dueOn: string;
  /** Gross from Jan 1 to the end of the quarter. */
  grossToDate: number;
  amount: number;
};

const QUARTERS = [
  { q: 1, months: 3, due: (y: number) => `${y}-05-15`, label: "1st quarter" },
  { q: 2, months: 6, due: (y: number) => `${y}-08-15`, label: "2nd quarter" },
  { q: 3, months: 9, due: (y: number) => `${y}-11-15`, label: "3rd quarter" },
  { q: 4, months: 12, due: (y: number) => `${y + 1}-04-15`, label: "annual" },
];

/** Every cutoff that starts from January 1 through the end of month `months`. */
function cutoffsThrough(year: number, months: number, cutoffs: Cutoffs): Period[] {
  const first = `${year}-01-01`;
  const last = addDays(months === 12 ? `${year + 1}-01-01` : dateInMonth(year, months + 1, 1), -1);
  let c = cutoffContaining(first, cutoffs);
  if (c.start < first) c = nextCutoff(c, cutoffs);
  const out: Period[] = [];
  for (; c.start <= last; c = nextCutoff(c, cutoffs)) out.push(c);
  return out;
}

/**
 * The 8% income tax for each quarter of `year`: the tax on gross so far,
 * minus what the earlier quarters already covered. Cutoffs you haven't saved
 * count as a normal work week.
 */
export function taxPayments(records: PayrollRecords, year: number, today: string): TaxPayment[] {
  const index = indexRecords(records);
  const days = cutoffRuleOf(records.settings);
  const pay = new Map(
    cutoffsThrough(year, 12, days).map((p) => [p.start, payForCutoff(records, p, today, index).total]),
  );
  let coveredTax = 0;
  return QUARTERS.map(({ q, months, due, label }) => {
    const grossToDate = roundCents(
      cutoffsThrough(year, months, days).reduce((sum, p) => sum + (pay.get(p.start) ?? 0), 0),
    );
    const tax = taxOnGross(grossToDate);
    const amount = roundCents(tax - coveredTax);
    coveredTax = tax;
    return {
      key: `${year}-Q${q}`,
      name: `Income tax 8%, ${label} ${year}`,
      dueOn: due(year),
      grossToDate,
      amount,
    };
  });
}

/** The next `count` tax payments due on or after today, including ones that come to ₱0. */
export function upcomingTaxPayments(records: PayrollRecords, today: string, count = 4): TaxPayment[] {
  const year = Number(today.slice(0, 4));
  return [year - 1, year, year + 1]
    .flatMap((y) => taxPayments(records, y, today))
    .filter((t) => t.dueOn >= today)
    .slice(0, count);
}

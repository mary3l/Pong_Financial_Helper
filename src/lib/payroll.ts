import { addDays, dateInMonth, nextPeriod, periodContaining, previousPeriod, weekdayOf, type Period } from "@/lib/dates";
import { roundCents } from "@/lib/money";
import { occurrences, type Schedule } from "@/lib/schedule";

// Payroll calculator (see 0013_payroll.sql). Pay is a daily rate times the
// days you worked in a cutoff, minus late minutes, plus overtime. Nobody
// deducts anything from it: SSS, PhilHealth, Pag-IBIG and the 8% income tax
// are bills you pay yourself, so they live in Money going out.
//
// A cutoff is a kinsena, paid one cutoff late: the 16th–end of month is paid
// on the next month's 15th, the 1st–15th on the 30th (or the month's last day).
//
// Pure, so the server and the browser share it.

/**
 * Contribution and tax rates. Update these when SSS, PhilHealth, Pag-IBIG or
 * the BIR change them.
 */
export const RATES = {
  /** Working days in a month, for the monthly pay contributions are based on. */
  workDaysPerMonth: 22,
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
};

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

/** Weekdays are work days, weekends off, and nothing before you started. */
export function defaultDay(date: string, startedOn: string | null = null): PayrollDay {
  const weekend = weekdayOf(date) === 0 || weekdayOf(date) === 6;
  const before = startedOn !== null && date < startedOn;
  return { date, status: weekend || before ? "off" : "worked", leaveType: null, note: null, timeIn: null };
}

/** The cutoff's days: saved ones, and the default for any not saved. */
export function daysFor(period: Period, saved: Map<string, PayrollDay>, startedOn: string | null): PayrollDay[] {
  return cutoffDates(period).map((date) => saved.get(date) ?? defaultDay(date, startedOn));
}

export type CutoffPay = {
  workedDays: number;
  sickDays: number;
  personalDays: number;
  basePay: number;
  lateMinutes: number;
  lateDeduction: number;
  overtimeMinutes: number;
  overtimePay: number;
  /** What lands on payday. Never below 0. */
  total: number;
};

/** Pay for one cutoff: days worked × daily rate − late + overtime. Leave is unpaid. */
export function cutoffPay(s: PayrollSettings, days: PayrollDay[], overtime: OvertimeEntry[]): CutoffPay {
  const worked = days.filter((d) => d.status === "worked");
  const lateMinutes = worked.reduce((sum, d) => sum + minutesLate(d.timeIn, s), 0);
  // Overtime counts on any day, a Saturday or holiday included.
  const otMinutes = overtime.reduce((sum, o) => sum + overtimeMinutes(o), 0);
  const perMinute = hourlyRate(s) / 60;
  const basePay = roundCents(worked.length * s.dailyRate);
  const lateDeduction = roundCents(lateMinutes * perMinute);
  const overtimePay = roundCents(otMinutes * perMinute * s.overtimeRate);
  return {
    workedDays: worked.length,
    sickDays: days.filter((d) => d.status === "leave" && d.leaveType === "sick").length,
    personalDays: days.filter((d) => d.status === "leave" && d.leaveType === "personal").length,
    basePay,
    lateMinutes,
    lateDeduction,
    overtimeMinutes: otMinutes,
    overtimePay,
    total: Math.max(0, roundCents(basePay - lateDeduction + overtimePay)),
  };
}

/** Saved days and overtime, ready to look up by date. */
export type PayrollRecords = {
  settings: PayrollSettings;
  days: PayrollDay[];
  overtime: OvertimeEntry[];
};

export type CutoffResult = CutoffPay & {
  period: Period;
  /** True while the cutoff isn't saved yet or hasn't ended. */
  estimate: boolean;
};

/** Pay for the cutoff `period`, from saved days or the default work week. */
export function payForCutoff(records: PayrollRecords, period: Period, today: string, index?: RecordIndex): CutoffResult {
  const { byDate, saved } = index ?? indexRecords(records);
  const days = daysFor(period, byDate, records.settings.startedOn);
  const overtime = records.overtime.filter((o) => o.date >= period.start && o.date <= period.end);
  const isSaved = cutoffDates(period).some((d) => saved.has(d));
  return {
    ...cutoffPay(records.settings, days, overtime),
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

/** The cutoff a payday pays for: the kinsena before the one it falls in. */
export function cutoffFor(payday: string): Period {
  return previousPeriod(periodContaining(payday));
}

/** The payday that pays for `cutoff`: the first one in the kinsena after it. */
export function paydayFor(cutoff: Period, schedule: Schedule): string {
  const next = nextPeriod(cutoff);
  return occurrences(schedule, next.start, addDays(next.end, 1))[0] ?? next.end;
}

/** Payday amounts by date, for the forecast, from `from` up to but not including `until`. */
export function paydayAmounts(
  records: PayrollRecords,
  schedule: Schedule,
  from: string,
  until: string,
  today: string,
): Record<string, { amount: number; estimate: boolean }> {
  const index = indexRecords(records);
  const out: Record<string, { amount: number; estimate: boolean }> = {};
  for (const date of occurrences(schedule, from, until)) {
    const pay = payForCutoff(records, cutoffFor(date), today, index);
    out[date] = { amount: pay.total, estimate: pay.estimate };
  }
  return out;
}

/** A typical cutoff: half a month of work days. Saved as the payday's amount. */
export function typicalCutoffPay(s: PayrollSettings): number {
  return roundCents((s.dailyRate * RATES.workDaysPerMonth) / 2);
}

/** What contributions are based on: your monthly pay. */
export function monthlyBase(s: PayrollSettings): number {
  return s.monthlyBase ?? roundCents(s.dailyRate * RATES.workDaysPerMonth);
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

/** Both cutoffs of every month from January through `months`. */
function cutoffsThrough(year: number, months: number): Period[] {
  return Array.from({ length: months }, (_, i) => i + 1).flatMap((m) => [
    { start: dateInMonth(year, m, 1), end: dateInMonth(year, m, 15) },
    { start: dateInMonth(year, m, 16), end: dateInMonth(year, m, 31) },
  ]);
}

/**
 * The 8% income tax for each quarter of `year`: the tax on gross so far,
 * minus what the earlier quarters already covered. Cutoffs you haven't saved
 * count as a normal work week.
 */
export function taxPayments(records: PayrollRecords, year: number, today: string): TaxPayment[] {
  const index = indexRecords(records);
  const pay = new Map(
    cutoffsThrough(year, 12).map((p) => [p.start, payForCutoff(records, p, today, index).total]),
  );
  let coveredTax = 0;
  return QUARTERS.map(({ q, months, due, label }) => {
    const grossToDate = roundCents(
      cutoffsThrough(year, months).reduce((sum, p) => sum + (pay.get(p.start) ?? 0), 0),
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

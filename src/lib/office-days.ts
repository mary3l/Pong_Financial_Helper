import { addDays, type Period } from "@/lib/dates";
import { isOwed, paidInAdvance, type ForecastItem } from "@/lib/forecast";
import { roundCents } from "@/lib/money";
import { cutoffFor, cutoffPay, cutoffRuleOf, daysFor, settingsFor, type PayrollRecords } from "@/lib/payroll";
import { MAX_GAP_DAYS, occurrences, type Schedule } from "@/lib/schedule";

// Plan › Bills by payday: every bill goes with the pay that covers it (the
// last payday on or before it's due), and with the payroll calculator, how
// many days you need to go in during that pay's cutoff to cover them. Pure,
// so it's easy to test.

/** How many paydays to show. */
export const PAYDAY_COUNT = 4;

export type OfficeDays = {
  dailyRate: number;
  /** Pay already earned in the cutoff: days before today, minus late, plus overtime. */
  earned: number;
  /** Work days left in the cutoff, from today: weekdays you haven't marked off or on leave. */
  daysLeft: number;
  /** The first of them, or null when none are left. */
  firstDay: string | null;
  /** The fewest of them to go in to cover what's needed. Null when even all of them aren't enough. */
  needed: number | null;
  /** What going in every day left still leaves uncovered (0 when it's enough). */
  short: number;
};

export type PaydayBills = {
  /** The payday, or null for the days before the next one (paid from what you have now). */
  payday: string | null;
  /** First and last day this money covers. */
  from: string;
  to: string;
  /** Unpaid bills, installments and utang due in it. Late ones go before the first payday. */
  bills: ForecastItem[];
  total: number;
  /** Bills due in these days that you already paid in advance: shown, but not in `total` or `need`. */
  paidEarly: ForecastItem[];
  /** Other income in these days (allowance, planned income). */
  otherIncome: number;
  /** What earlier periods couldn't cover, carried into this one. */
  carriedIn: number;
  /** Bills + carried in − other income, never below 0. */
  need: number;
  /** Payday: its estimate if you work every day of the cutoff. Before payday: spending money in your wallets. */
  money: number | null;
  /** Money minus need. Below 0 means short. Null when the pay isn't known. */
  left: number | null;
  /** The cutoff this payday pays for. Null before payday. */
  cutoff: Period | null;
  /** With the payroll calculator, on a payday. */
  office: OfficeDays | null;
};

const sum = (items: ForecastItem[]) => roundCents(items.reduce((total, i) => total + (i.amount ?? 0), 0));

const isBill = (i: ForecastItem) => isOwed(i) && i.amount !== null && i.kind !== "pautang";

const isOtherIncome = (i: ForecastItem) => i.flow === "in" && i.kind !== "payday" && !i.transactionId && i.amount !== null;

/**
 * The work days left in `cutoff` from `today` and what's earned before
 * today, from the days you saved (or the usual work week).
 */
export function officeDays(records: PayrollRecords, cutoff: Period, today: string, need: number): OfficeDays {
  const days = daysFor(cutoff, new Map(records.days.map((d) => [d.date, d])), records.settings.startedOn, records.settings);
  const past = days.filter((d) => d.date < today);
  const ahead = days.filter((d) => d.date >= today && d.status === "worked");
  const overtime = records.overtime.filter((o) => o.date >= cutoff.start && o.date < today && o.date <= cutoff.end);
  const settings = settingsFor(records, cutoff.start);
  const earned = past.length ? cutoffPay(settings, past, overtime).total : 0;
  const rate = settings.dailyRate;
  const toEarn = Math.max(0, roundCents(need - earned));
  const fewest = rate > 0 ? Math.max(0, Math.ceil(toEarn / rate - 1e-9)) : Infinity;
  const enough = fewest <= ahead.length;
  return {
    dailyRate: rate,
    earned,
    daysLeft: ahead.length,
    firstDay: ahead[0]?.date ?? null,
    needed: enough ? fewest : null,
    short: enough ? 0 : roundCents(toEarn - ahead.length * rate),
  };
}

/**
 * Bills grouped by the pay that covers them: from each payday to the day
 * before the next. What's due before the next payday comes out of what you
 * have now. When a period can't be covered even working every day, the rest
 * carries into the next one.
 */
export function billsByPayday({
  items,
  today,
  payday,
  inWallets,
  payroll,
  count = PAYDAY_COUNT,
}: {
  items: ForecastItem[];
  today: string;
  payday: Schedule;
  /** Spending money in your wallets now. */
  inWallets: number;
  /** The payroll calculator's records, when it's set up. */
  payroll: PayrollRecords | null;
  count?: number;
}): PaydayBills[] {
  // count + 1 paydays: each period ends the day before the next one. Paydays
  // can be months apart (only the 5th Friday), so look as far as that needs.
  const paydays = occurrences(payday, addDays(today, 1), addDays(today, MAX_GAP_DAYS * (count + 1) + 1)).slice(0, count + 1);
  if (!paydays.length) return [];
  const bills = items.filter(isBill);
  const out: PaydayBills[] = [];
  let carried = 0;

  const windows = [
    { payday: null as string | null, from: today, until: paydays[0] },
    // A period needs the payday after it to end.
    ...paydays.slice(0, -1).slice(0, count).map((p, i) => ({ payday: p as string | null, from: p, until: paydays[i + 1] })),
  ];
  for (const w of windows) {
    const first = w.payday === null;
    const inWindow = (i: ForecastItem) => (i.dueOn >= w.from || first) && i.dueOn < w.until;
    const due = bills.filter(inWindow);
    const paidEarly = items.filter((i) => paidInAdvance(i) && i.kind !== "pautang" && i.dueOn >= w.from && i.dueOn < w.until);
    const otherIncome = sum(items.filter((i) => isOtherIncome(i) && i.dueOn >= w.from && i.dueOn < w.until));
    const total = sum(due);
    const need = Math.max(0, roundCents(total + carried - otherIncome));
    const payItem = w.payday ? items.find((i) => i.kind === "payday" && i.dueOn === w.payday) : undefined;
    const cutoff = w.payday && payroll ? cutoffFor(w.payday, cutoffRuleOf(payroll.settings)) : null;
    const office = cutoff && payroll ? officeDays(payroll, cutoff, today, need) : null;
    const money = first ? inWallets : (payItem?.amount ?? null);
    const left = money === null ? null : roundCents(money - need);
    out.push({
      payday: w.payday,
      from: w.from,
      to: addDays(w.until, -1),
      bills: due,
      total,
      paidEarly,
      otherIncome,
      carriedIn: carried,
      need,
      money,
      left,
      cutoff,
      office,
    });
    // Only a shortfall carries over: anything left is yours to spend until then.
    carried = office ? office.short : left !== null && left < 0 ? -left : 0;
  }
  // The days before payday only when something's due (or was paid early) in them.
  return out[0].bills.length || out[0].paidEarly.length ? out : out.slice(1);
}

import { addDays, daysBetween, formatShortDay } from "@/lib/dates";
import {
  affordVerdict,
  isOwed,
  project,
  splitAmount,
  type ForecastItem,
  type Purchase,
  type Verdict,
} from "@/lib/forecast";
import { bnplFirstDue } from "@/lib/installments";
import { formatPeso, roundCents, type AccountType } from "@/lib/money";
import { occurrences, nextOccurrence, type Schedule } from "@/lib/schedule";

// BNPL credit you can still use: shown next to Safe to spend, never in it.
// It's borrowed, so it never counts in You have, Net worth, the forecast or
// the daily amount. Pong caps it each month from your own records, because
// a limit is what the provider lets you borrow, not what you can pay back.
// Pure, so the browser can use it too.

export type CreditRoom = {
  id: string;
  name: string;
  /** Null when no limit is saved on the line. */
  limit: number | null;
  /** What you owe on it now. */
  owed: number;
  /** Limit minus what you owe, never below 0. Null without a limit. */
  creditLeft: number | null;
  /** The day of the month its bill is due. */
  dueDay: number | null;
  /** The day its statement closes, if saved. */
  cutoffDay?: number | null;
};

type CreditAccount = {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  creditLimit: number | null;
  dueDay: number | null;
  cutoffDay?: number | null;
};

/** Every BNPL line and how much of its limit is left. */
export function creditRoom(accounts: CreditAccount[]): CreditRoom[] {
  return accounts
    .filter((a) => a.type === "credit_line")
    .map((a) => {
      const owed = roundCents(Math.max(0, -a.balance));
      const limit = a.creditLimit && a.creditLimit > 0 ? a.creditLimit : null;
      return {
        id: a.id,
        name: a.name,
        limit,
        owed,
        creditLeft: limit === null ? null : roundCents(Math.max(0, limit - owed)),
        dueDay: a.dueDay,
        cutoffDay: a.cutoffDay ?? null,
      };
    });
}

// ── Pong's monthly cap ──────────────────────────────────────────────────

/** Every installment and loan payment together stays under this share of what you take home. */
export const DEBT_SHARE = 0.15;
/** …and under this share of what's left after your spending, so you keep the rest. */
export const SURPLUS_SHARE = 0.5;
/** Months of records the cap looks back over. */
export const HISTORY_MONTHS = 3;

/** Income and expenses over the last few full months. */
export type MoneyHistory = {
  income: number;
  spending: number;
  /** How many of those months have any records (0 to HISTORY_MONTHS). */
  months: number;
  /** True when it's one month estimated by `estimateMonth`, not records. */
  estimated?: boolean;
};

/** Days of records this month before Pong estimates a month from them. */
export const MIN_DAYS_TO_ESTIMATE = 7;

/**
 * One month from what Pong knows, before there's a full month of records:
 * your scheduled pay and income in the next 30 days in; bills and planned
 * expenses in the next 30 days, plus day-to-day spending at this month's
 * rate so far, out. Installments and loans aren't in it: the cap counts
 * them on their own. Null with under a week of records.
 */
export function estimateMonth({
  items,
  today,
  dayToDay,
  daysLogged,
}: {
  items: ForecastItem[];
  today: string;
  /** This month's expenses that weren't bills, planned items or installments. */
  dayToDay: number;
  /** Days from your first record this month through today. */
  daysLogged: number;
}): MoneyHistory | null {
  if (daysLogged < MIN_DAYS_TO_ESTIMATE) return null;
  const monthOut = addDays(today, 30);
  const next = items.filter((i) => i.dueOn >= today && i.dueOn < monthOut && i.amount !== null);
  const sum = (list: ForecastItem[]) => list.reduce((total, i) => total + i.amount!, 0);
  const income = sum(next.filter((i) => i.kind === "payday" || i.kind === "income" || (i.kind === "planned" && i.flow === "in")));
  const bills = sum(next.filter((i) => i.kind === "bill" || (i.kind === "planned" && i.flow === "out")));
  return {
    income: roundCents(income),
    spending: roundCents(bills + (dayToDay / daysLogged) * 30),
    months: 1,
    estimated: true,
  };
}

export type BnplCap = {
  /** "unknown": not enough records yet, so there's no cap. "paused": ₱0 this month. */
  status: "set" | "paused" | "unknown";
  /** One sentence on why. */
  reason: string;
  /** Monthly averages. */
  income: number;
  /** True while it's estimated from this month and your schedule (no full month of records yet). */
  estimated: boolean;
  spending: number;
  surplus: number;
  months: number;
  /** DEBT_SHARE of income and SURPLUS_SHARE of the surplus. */
  byIncome: number;
  bySurplus: number;
  /** The most every BNPL and loan payment together should take a month. */
  ceiling: number;
  /** Installment and loan payments due in the next 30 days, late ones too. */
  debtPayments: number;
  /** New BNPL this month. Null when unknown. */
  cap: number | null;
  /** Charged to your credit lines this month. */
  used: number;
  /** Cap minus used, never below 0. Null when unknown. */
  left: number | null;
};

function floorTo100(amount: number): number {
  return Math.max(0, Math.floor(amount / 100) * 100);
}

/**
 * How much new BNPL fits this month. New purchases are paid back over the
 * next months, so the cap is what's left of the payment ceiling after the
 * installments already running. Each purchase raises next month's payments
 * and so lowers next month's cap: it keeps itself in check.
 *
 * Paused when a bill or installment is late, when the forecast dips below
 * ₱0 within 30 days, or when you spend more than you take home.
 */
export function bnplCap({
  history,
  items,
  start,
  today,
  used,
}: {
  history: MoneyHistory;
  items: ForecastItem[];
  /** Spending money in your wallets now. */
  start: number;
  today: string;
  used: number;
}): BnplCap {
  used = roundCents(used);
  const months = history.months;
  const income = months ? roundCents(history.income / months) : 0;
  const spending = months ? roundCents(history.spending / months) : 0;
  const surplus = roundCents(income - spending);
  const byIncome = roundCents(income * DEBT_SHARE);
  const bySurplus = roundCents(Math.max(0, surplus) * SURPLUS_SHARE);
  const ceiling = Math.min(byIncome, bySurplus);
  const monthOut = addDays(today, 30);
  const debtPayments = roundCents(
    items
      .filter((i) => i.kind === "installment" && isOwed(i) && i.dueOn < monthOut)
      .reduce((sum, i) => sum + (i.amount ?? 0), 0),
  );
  const estimated = Boolean(history.estimated);
  const base = { income, estimated, spending, surplus, months, byIncome, bySurplus, ceiling, debtPayments, used };
  const paused = (reason: string): BnplCap => ({ ...base, status: "paused", reason, cap: 0, left: 0 });

  // These two don't need any history: they pause BNPL from day one.
  const late = items.find((i) => (i.kind === "bill" || i.kind === "installment") && isOwed(i) && i.dueOn < today);
  if (late) return paused(`${late.name} is late. Pay it first, then BNPL opens again.`);
  const low = project(start, items, today, 30).lowest;
  if (low.balance < 0) {
    return paused(`Your forecast dips below ₱0 on ${formatShortDay(low.date, today)}, so no new BNPL for now.`);
  }
  if (!months || income <= 0) {
    return {
      ...base,
      status: "unknown",
      reason: "Log a week of spending and save your pay in Payroll, and I'll set a monthly cap.",
      cap: null,
      left: null,
    };
  }
  if (surplus <= 0) return paused("You've been spending all you take home, so there's nothing to pay BNPL back with.");

  const cap = floorTo100(ceiling - debtPayments);
  if (cap === 0) {
    return paused(
      `Installments and loans already take ${formatPeso(debtPayments)} of the ${formatPeso(ceiling)} a month I'd allow.`,
    );
  }
  const left = roundCents(Math.max(0, cap - used));
  return {
    ...base,
    status: "set",
    reason: left > 0 ? `Up to ${formatPeso(cap)} of new BNPL this month.` : "You've reached this month's cap.",
    cap,
    left,
  };
}

/** What you can still put on each line: what's left of its limit, within the cap. */
export function usableOn(line: CreditRoom, capLeft: number | null): number | null {
  if (capLeft === null) return line.creditLeft;
  return line.creditLeft === null ? capLeft : Math.min(line.creditLeft, capLeft);
}

/** What you can still use across every line: the limits left, but never past the cap. */
export function totalUsable(lines: CreditRoom[], capLeft: number | null): number {
  const limits = roundCents(lines.reduce((sum, l) => sum + (l.creditLeft ?? 0), 0));
  const noLimit = lines.some((l) => l.creditLeft === null);
  if (capLeft === null) return limits;
  return noLimit ? capLeft : Math.min(limits, capLeft);
}

// ── Can I afford this? ──────────────────────────────────────────────────

/** The kinsenas (or week, or month) a payment falls in: from the payday on or before it to the next one. */
export function payCycle(payday: Schedule, date: string): { from: string; until: string } {
  const from = occurrences(payday, addDays(date, -40), addDays(date, 1)).at(-1)!;
  return { from, until: nextOccurrence(payday, date) };
}

export type CreditOption = {
  line: CreditRoom;
  /** What you could put on it the day you'd buy. */
  room: number;
  /** True when Pong's cap, not the limit, is what holds it back. */
  capped: boolean;
  /** False when the price is over `room`. */
  fits: boolean;
  /** The first bill this purchase lands on. */
  firstDue: string;
  /** The first monthly payment, before any fee or interest. */
  payment: number;
  months: number;
  /** The forecast with the payments on this line's due days. */
  verdict: Verdict | null;
  /**
   * How much the first payment takes from each day of the pay cycle it's
   * due in, so the daily amount then drops by about this. Null without a payday.
   */
  perDay: number | null;
  cycle: { from: string; until: string } | null;
};

/**
 * "Can I afford this?" if you used BNPL: the purchase goes on each line the
 * day you pick, and you pay it back on that line's due days. Paying back
 * still comes from your own money, so it's tested against the same forecast.
 * There's no "wait until payday" here: the due day is fixed. A purchase in a
 * later month is held to that month's cap, which starts over.
 */
export function affordWithCredit({
  start,
  items,
  purchase,
  today,
  payday,
  lines,
  cap,
}: {
  start: number;
  items: ForecastItem[];
  purchase: Purchase;
  today: string;
  payday: Schedule | null;
  lines: CreditRoom[];
  cap: BnplCap;
}): CreditOption[] {
  const sameMonth = purchase.first.slice(0, 7) === today.slice(0, 7);
  const capRoom = sameMonth ? cap.left : cap.cap;
  return lines
    .filter((l) => usableOn(l, capRoom) !== null)
    .map((line) => {
      const room = usableOn(line, capRoom)!;
      const capped = capRoom !== null && (line.creditLeft === null || capRoom < line.creditLeft);
      const firstDue = bnplFirstDue(purchase.first, line.dueDay, line.cutoffDay ?? null);
      const payment = splitAmount(purchase.amount, purchase.months)[0];
      const fits = purchase.amount <= room;
      const verdict = fits
        ? affordVerdict({ start, items, purchase: { ...purchase, first: firstDue }, today, nextPayday: null })
        : null;
      const cycle = payday ? payCycle(payday, firstDue) : null;
      const perDay = cycle ? Math.ceil(payment / daysBetween(cycle.from, cycle.until)) : null;
      return { line, room, capped, fits, firstDue, payment, months: purchase.months, verdict, perDay, cycle };
    });
}

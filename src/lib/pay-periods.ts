import { addDays } from "@/lib/dates";
import { isOwed, monthlyDates, type ForecastItem } from "@/lib/forecast";
import { roundCents } from "@/lib/money";

// Forecast › Payments by pay period: every BNPL and loan payment, grouped
// into month-long periods starting on payday, against the pay that comes in
// during each one. Pure, so it's easy to test.

/** How many month-long periods to show. */
export const PERIOD_COUNT = 3;

/** Days of forecast items these periods need: a lead-in to payday plus PERIOD_COUNT months. */
export const PERIOD_DAYS = 31 * (PERIOD_COUNT + 1);

export type PeriodPayments = {
  /** First day. */
  from: string;
  /** Last day (inclusive). */
  to: string;
  /** Unpaid BNPL and loan payments, by date. Late ones are in the first period. */
  payments: ForecastItem[];
  total: number;
  /** Pay and other income scheduled in the period. */
  income: number;
  /** Payments as a share of income (0.87 = 87%). Null when no income is known. */
  share: number | null;
  /** Per credit line or loan, biggest first. */
  byLender: { lenderId: string | null; total: number }[];
};

const sum = (items: ForecastItem[]) => roundCents(items.reduce((total, i) => total + (i.amount ?? 0), 0));

function isIncome(i: ForecastItem): boolean {
  return i.kind === "payday" || i.kind === "income" || (i.kind === "planned" && i.flow === "in");
}

/**
 * Month-long periods from the next payday (Nov 15 – Dec 14, Dec 15 – Jan 14,
 * …), or from today without a payday. Days before the first payday get
 * their own period when something's due in them, and late payments go in
 * the first period shown.
 */
export function paymentsByPeriod({
  items,
  today,
  nextPayday,
  count = PERIOD_COUNT,
}: {
  items: ForecastItem[];
  today: string;
  nextPayday: string | null;
  count?: number;
}): PeriodPayments[] {
  const starts = monthlyDates(nextPayday ?? today, count + 1);
  const windows = starts.slice(0, count).map((from, i) => ({ from, until: starts[i + 1] }));
  if (nextPayday && nextPayday > today) windows.unshift({ from: today, until: nextPayday });

  const owed = items.filter((i) => i.kind === "installment" && isOwed(i));
  const periods = windows.map(({ from, until }, index) => {
    const inWindow = (i: ForecastItem) => i.dueOn >= from && i.dueOn < until;
    const payments = owed.filter((i) => inWindow(i) || (index === 0 && i.dueOn < from));
    const total = sum(payments);
    const income = sum(items.filter((i) => isIncome(i) && inWindow(i)));
    const lenders = new Map<string | null, number>();
    for (const p of payments) lenders.set(p.lenderId ?? null, (lenders.get(p.lenderId ?? null) ?? 0) + (p.amount ?? 0));
    return {
      from,
      to: addDays(until, -1),
      payments,
      total,
      income,
      share: income > 0 ? total / income : null,
      byLender: [...lenders]
        .map(([lenderId, amount]) => ({ lenderId, total: roundCents(amount) }))
        .sort((a, b) => b.total - a.total),
    };
  });
  // The days before payday only when something's due in them.
  return nextPayday && nextPayday > today && !periods[0].payments.length ? periods.slice(1) : periods;
}

/** Where a group of payments goes: one credit line or loan, a person you owe, or one bill. */
export type PayTo = {
  key: string;
  name: string;
  /** The credit line or loan, for installments. */
  lenderId: string | null;
  total: number;
  /** How many payments are in it. */
  count: number;
  firstDue: string;
  lastDue: string;
  /** One of them is past its date. */
  late: boolean;
  /**
   * A bill, income or planned item of yours, one id throughout: what Edit
   * opens in Plan › Scheduled. Null for installments and utang.
   */
  editId: string | null;
};

/**
 * Payments grouped by where the money goes: every installment on Atome
 * together, every SLoan payment together, and each other bill on its own.
 * Soonest first.
 */
export function groupByPayee(items: ForecastItem[], lenderName: (id: string) => string | undefined, today: string): PayTo[] {
  const groups = new Map<string, PayTo>();
  for (const i of items) {
    // Installments and anything bought on a credit line go with that line's bill.
    const lender = (i.kind === "installment" || i.boughtOn) && i.lenderId ? i.lenderId : null;
    const key = lender ? `lender|${lender}` : i.kind === "utang" ? `utang|${i.id}` : `item|${i.name}`;
    const name = (lender && lenderName(lender)) || i.name;
    const editable = i.kind === "bill" || i.kind === "planned" || i.kind === "income";
    const g =
      groups.get(key) ??
      { key, name, lenderId: lender, total: 0, count: 0, firstDue: i.dueOn, lastDue: i.dueOn, late: false, editId: editable ? i.id : null };
    // Two planned items with the same name are two rows in Scheduled: nothing single to edit.
    if (!editable || g.editId !== i.id) g.editId = null;
    g.total = roundCents(g.total + (i.amount ?? 0));
    g.count += 1;
    if (i.dueOn < g.firstDue) g.firstDue = i.dueOn;
    if (i.dueOn > g.lastDue) g.lastDue = i.dueOn;
    g.late ||= i.dueOn < today;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.firstDue.localeCompare(b.firstDue) || b.total - a.total);
}

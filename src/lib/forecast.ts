import { addDays, dateInMonth } from "@/lib/dates";
import { roundCents } from "@/lib/money";
import type { DeductionKind } from "@/lib/payroll";
import { amountOn, nextOccurrence, occurrences, type Schedule } from "@/lib/schedule";

// The forecast (design canvas 3.1): what's scheduled, and what it does to
// your wallets. The payment plan (payment-plan.ts) builds on it. Pure, so the server and the browser share it.
//
// Only cash, bank and e-wallet money is counted. Scheduled items count until
// they're logged ("Mark paid" or "Add income"): then the wallet balance
// already reflects them and the item drops out.

export type ForecastKind =
  "payday" | "income" | "bill" | "planned" | "installment" | "utang" | "pautang";

/** Something scheduled to move money on a date. */
export type ForecastItem = {
  /** Unique within one forecast. */
  key: string;
  kind: ForecastKind;
  /** Money coming in (pay, income) or going out (bills, expenses). */
  flow: "in" | "out";
  /** The recurring_items, planned_expenses or scheduled_payments row, or the person. */
  id: string;
  name: string;
  /** Always positive. Null for a payday with no net pay saved. */
  amount: number | null;
  /** The scheduled date. A late planned item keeps its own date. */
  dueOn: string;
  accountId: string | null;
  category: string | null;
  /** Amounts that change, like electricity. */
  estimate: boolean;
  /** Set once it was logged as a real transaction. */
  transactionId: string | null;
  /** A payday moved to another day (a holiday): the date it's logged under. Missing: `dueOn`. */
  scheduledOn?: string;
  /** The day that transaction happened, when known: before `dueOn` means it was paid in advance. */
  paidOn?: string | null;
  /** Installments, and bills or planned expenses bought on a credit line: the line it's billed on. */
  lenderId?: string | null;
  /** Bought on a credit line: the day you buy it. `dueOn` is then the card bill it lands on. */
  boughtOn?: string | null;
  /** Installments: the plan's last payment. */
  lastPayment?: boolean;
  /** Installments: the fee or interest in this payment, which paying early can cut. */
  fee?: number;
  /** Contributions the payroll calculator manages (SSS, PhilHealth, Pag-IBIG). You pay them yourself. */
  fromPayroll?: boolean;
  /** Payday: pay before what your office takes, and each contribution it takes. `amount` is what's left. */
  pay?: PayBreakdown;
};

/** A payday's gross pay and what your office takes from it: contributions, tax, salary loan payments. */
export type PayBreakdown = {
  gross: number;
  deductions: {
    name: string;
    amount: number;
    /** Pong's estimate, not your payslip's amount. */
    estimated?: boolean;
    /** Which contribution it is: GSIS, SSS, PhilHealth and Pag-IBIG are listed first. */
    kind?: DeductionKind;
    /** A salary loan's scheduled payment: logging the payday pays it. */
    loanPaymentId?: string;
  }[];
};

export type ScheduleInputs = {
  recurring: (Schedule & {
    id: string;
    kind: "payday" | "bill" | "income";
    name: string;
    amount: number | null;
    amountVaries: boolean;
    accountId: string | null;
    category: string | null;
    endsOn: string | null;
    /** Bills: the day it was added. Unpaid dates from then on stay owed; missing, none do. */
    startsOn?: string | null;
    /** Set when the payroll calculator manages it. */
    payrollKey?: string | null;
  })[];
  billPayments: { recurringItemId: string; dueOn: string; transactionId: string }[];
  planned: {
    id: string;
    type: "expense" | "income";
    name: string;
    amount: number;
    category: string;
    dueOn: string;
    accountId: string | null;
    transactionId: string | null;
  }[];
  /**
   * Payroll calculator: each payday's own amount by date, replacing the
   * payday's saved amount.
   */
  paydayAmounts?: Record<
    string,
    {
      amount: number;
      estimate: boolean;
      paidOn?: string;
      gross?: number;
      deductions?: PayBreakdown["deductions"];
    }
  >;
  /** BNPL and loan payments (Phase 3). */
  installments?: {
    id: string;
    name: string;
    dueOn: string;
    amount: number;
    payFromAccountId: string | null;
    /** The transfer or fee transaction, once paid. */
    transactionId: string | null;
    /** The credit line or loan it pays. */
    lenderAccountId?: string;
    /** Which payment of how many. */
    seq?: number;
    months?: number;
    /** The fee or interest in this payment. */
    fee?: number;
  }[];
};

/** The category a recurring item logs under when it has none saved. */
export function recurringCategory(r: {
  kind: "payday" | "bill" | "income";
  category: string | null;
}): string {
  if (r.category) return r.category;
  return r.kind === "bill" ? "bills" : r.kind === "payday" ? "salary" : "other_income";
}

/** How far back an unpaid recurring bill stays owed. Load bill payments from this far back too. */
export const LATE_BILL_DAYS = 31;

/**
 * Every payday, recurring item and planned item from `from` up to but not
 * including `until`, by date. Unlogged planned items from before `from` are
 * included too, since they're still expected, and so are unpaid bills from
 * the last LATE_BILL_DAYS (not before the bill was added). Pay and income
 * from before `from` never are: money you haven't received doesn't count.
 */
export function scheduledItems(
  { recurring, billPayments, planned, installments = [], paydayAmounts = {} }: ScheduleInputs,
  from: string,
  until: string,
): ForecastItem[] {
  const logged = new Map(
    billPayments.map((p) => [`${p.recurringItemId}|${p.dueOn}`, p.transactionId]),
  );
  const items: ForecastItem[] = [];

  for (const r of recurring) {
    const end = r.endsOn && r.endsOn < until ? addDays(r.endsOn, 1) : until;
    if (r.kind === "bill" && r.startsOn) {
      const lookBack = addDays(from, -LATE_BILL_DAYS);
      const since = r.startsOn > lookBack ? r.startsOn : lookBack;
      const lateUntil = end < from ? end : from;
      for (const date of occurrences(r, since, lateUntil)) {
        if (logged.has(`${r.id}|${date}`)) continue;
        items.push({
          key: `bill|${r.id}|${date}`,
          kind: "bill",
          flow: "out",
          id: r.id,
          name: r.name,
          amount: r.amount,
          dueOn: date,
          accountId: r.accountId,
          category: recurringCategory(r),
          estimate: r.amountVaries,
          transactionId: null,
          ...(r.payrollKey ? { fromPayroll: true } : {}),
        });
      }
    }
    for (const date of occurrences(r, from, end)) {
      const payroll = r.kind === "payday" ? paydayAmounts[date] : undefined;
      items.push({
        key: `${r.kind}|${r.id}|${date}`,
        kind: r.kind,
        flow: r.kind === "bill" ? "out" : "in",
        id: r.id,
        name: r.kind === "payday" ? "Payday" : r.name,
        // A payday can bring a different amount each week or each payday.
        amount: payroll ? payroll.amount : r.kind === "payday" ? amountOn(r, date) : r.amount,
        // Paid on another day this time; logged under its usual date.
        dueOn: payroll?.paidOn ?? date,
        ...(payroll?.paidOn ? { scheduledOn: date } : {}),
        accountId: r.accountId,
        category: recurringCategory(r),
        estimate: payroll ? payroll.estimate : r.amountVaries,
        transactionId: logged.get(`${r.id}|${date}`) ?? null,
        ...(r.payrollKey ? { fromPayroll: true } : {}),
        ...(payroll?.deductions?.length
          ? {
              pay: {
                gross: payroll.gross!,
                deductions: payroll.deductions.map((d) => ({
                  name: d.name,
                  amount: d.amount,
                  ...(d.estimated ? { estimated: true } : {}),
                  ...(d.kind ? { kind: d.kind } : {}),
                  ...(d.loanPaymentId ? { loanPaymentId: d.loanPaymentId } : {}),
                })),
              },
            }
          : {}),
      });
    }
  }

  for (const p of planned) {
    const late = p.dueOn < from && !p.transactionId;
    if (!late && (p.dueOn < from || p.dueOn >= until)) continue;
    items.push({
      key: `planned|${p.id}`,
      kind: "planned",
      flow: p.type === "income" ? "in" : "out",
      id: p.id,
      name: p.name,
      amount: p.amount,
      dueOn: p.dueOn,
      accountId: p.accountId,
      category: p.category,
      estimate: false,
      transactionId: p.transactionId,
    });
  }

  // Unpaid installments stay owed after their date, like planned expenses.
  for (const p of installments) {
    const late = p.dueOn < from && !p.transactionId;
    if (!late && (p.dueOn < from || p.dueOn >= until)) continue;
    items.push({
      key: `installment|${p.id}`,
      kind: "installment",
      flow: "out",
      id: p.id,
      name: p.name,
      amount: p.amount,
      dueOn: p.dueOn,
      accountId: p.payFromAccountId,
      category: null,
      estimate: false,
      transactionId: p.transactionId,
      lenderId: p.lenderAccountId ?? null,
      // Not a one-payment bill ("October Billing"): only a plan's final payment.
      lastPayment: p.months !== undefined && p.months > 1 && p.seq === p.months,
      ...(p.fee ? { fee: p.fee } : {}),
    });
  }

  return sortItems(items);
}

export function sortItems(items: ForecastItem[]): ForecastItem[] {
  return items.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name));
}

/** What an item does to your wallets: + for money in, − for money out, 0 once logged. */
export function itemEffect(item: ForecastItem): number {
  if (item.amount === null || item.transactionId) return 0;
  return item.flow === "in" ? item.amount : -item.amount;
}

/** Money going out that you paid before its due date. */
export function paidInAdvance(
  item: Pick<ForecastItem, "flow" | "transactionId" | "paidOn" | "dueOn">,
): boolean {
  return (
    item.flow === "out" &&
    Boolean(item.transactionId) &&
    Boolean(item.paidOn) &&
    item.paidOn! < item.dueOn
  );
}

/** Unlogged money going out: what you still owe. */
export function isOwed(item: ForecastItem): boolean {
  return item.flow === "out" && !item.transactionId;
}

/** "Bill", "Planned income", … for lists. */
export function itemLabel(item: Pick<ForecastItem, "kind" | "flow">): string {
  switch (item.kind) {
    case "payday":
      return "Pay";
    case "income":
      return "Income";
    case "bill":
      return "Bill";
    case "planned":
      return item.flow === "in" ? "Planned income" : "Planned";
    case "installment":
      return "Installment";
    case "utang":
      return "Utang";
    case "pautang":
      return "Pautang";
  }
}

export type DayBalance = { date: string; balance: number };

export type Projection = {
  /** Projected balance at the end of each day, starting today. */
  days: DayBalance[];
  /** Items that change the balance, each with the balance after it. */
  rows: { item: ForecastItem; date: string; balanceAfter: number }[];
  lowest: DayBalance;
};

/**
 * Projects wallet money day by day from `from` for `length` days. Late
 * planned expenses land on the first day.
 */
export function project(
  start: number,
  items: ForecastItem[],
  from: string,
  length: number,
): Projection {
  const until = addDays(from, length);
  const events = items
    .map((item) => ({
      item,
      date: item.dueOn < from ? from : item.dueOn,
      change: itemEffect(item),
    }))
    .filter(
      (e) =>
        e.date < until && (e.change !== 0 || (e.item.kind === "payday" && e.item.amount === null)),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const rows: Projection["rows"] = [];
  let running = start;
  for (const e of events) {
    running = roundCents(running + e.change);
    rows.push({ item: e.item, date: e.date, balanceAfter: running });
  }

  const days: DayBalance[] = [];
  let balance = start;
  let i = 0;
  for (let d = 0; d < length; d++) {
    const date = addDays(from, d);
    while (i < events.length && events[i].date === date)
      balance = roundCents(balance + events[i++].change);
    days.push({ date, balance });
  }

  return { days, rows, lowest: lowestOf(days) };
}

function lowestOf(days: DayBalance[]): DayBalance {
  return days.reduce((low, d) => (d.balance < low.balance ? d : low), days[0]);
}

/** The lowest end-of-day balance from `from` up to but not including `until`. */
export function lowestBetween(days: DayBalance[], from: string, until: string): DayBalance | null {
  const window = days.filter((d) => d.date >= from && d.date < until);
  return window.length ? lowestOf(window) : null;
}

/**
 * The next payday after today whose pay you haven't received yet. Pay marked
 * received early is already in your wallets, so that payday is done and Safe
 * to spend lasts until the one after it. Undo it and it counts again. Paydays
 * moved to another day match by their usual date.
 */
export function nextUnreceivedPayday(
  payday: Schedule,
  items: ForecastItem[],
  today: string,
): string {
  const received = new Set(
    items
      .filter((i) => i.kind === "payday" && i.transactionId)
      .map((i) => i.scheduledOn ?? i.dueOn),
  );
  let next = nextOccurrence(payday, today);
  // Items only reach so far ahead, so this always stops; the cap is a guard.
  for (let n = 0; n < 400 && received.has(next); n++) next = nextOccurrence(payday, next);
  return next;
}

/** `count` monthly dates on the same day as `first`, short months clamped. */
export function monthlyDates(first: string, count: number): string[] {
  const [y, m, d] = first.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const month = m - 1 + i;
    return dateInMonth(y + Math.floor(month / 12), (month % 12) + 1, d);
  });
}

/** Splits an amount into `count` payments; the last absorbs the rounding. */
export function splitAmount(amount: number, count: number): number[] {
  // In whole centavos, so 2.30 ÷ 2 is 1.15 + 1.15, not 1.14 + 1.16.
  const cents = Math.round(amount * 100);
  const each = Math.floor(cents / count);
  return Array.from(
    { length: count },
    (_, i) => (i === count - 1 ? cents - each * (count - 1) : each) / 100,
  );
}

export type Purchase = { name: string; amount: number; first: string; months: number };

/** The purchase as planned expenses: one, or one per installment. */
export function purchaseItems(p: Purchase): ForecastItem[] {
  const amounts = splitAmount(p.amount, p.months);
  return paymentItems(
    p.name,
    monthlyDates(p.first, p.months).map((dueOn, i) => ({ dueOn, amount: amounts[i] })),
  );
}

/** Payments as planned expenses, "Shoes (2 of 3)" when there's more than one: a purchase, or its card or BNPL bills. */
export function paymentItems(
  name: string,
  payments: { dueOn: string; amount: number }[],
): ForecastItem[] {
  return payments.map((p, i) => ({
    key: `purchase|${i}`,
    kind: "planned",
    flow: "out",
    id: `purchase-${i}`,
    name: payments.length > 1 ? `${name} (${i + 1} of ${payments.length})` : name,
    amount: p.amount,
    dueOn: p.dueOn,
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
  }));
}

export type WalletCheck = {
  /** The payment date where the wallet is lowest after paying. */
  date: string;
  /** About what's in the wallet that day before paying, and after. */
  before: number;
  after: number;
};

/**
 * Whether one wallet has enough for a purchase: its balance now, plus the
 * pay and bills set to go through it, on each payment date. Returns the
 * tightest date. Bills with no wallet set aren't counted against it.
 */
export function walletCheck({
  balance,
  walletId,
  items,
  purchase,
  today,
}: {
  balance: number;
  walletId: string;
  items: ForecastItem[];
  purchase: Purchase;
  today: string;
}): WalletCheck {
  const own = items.filter((i) => i.accountId === walletId);
  const payments = purchaseItems(purchase);
  let worst: WalletCheck | null = null;
  for (const p of payments) {
    const before = roundCents(
      balance +
        own
          .filter((i) => (i.dueOn < today ? today : i.dueOn) <= p.dueOn)
          .reduce((sum, i) => sum + itemEffect(i), 0) -
        payments.filter((x) => x.dueOn < p.dueOn).reduce((sum, x) => sum + (x.amount ?? 0), 0),
    );
    const after = roundCents(before - (p.amount ?? 0));
    if (!worst || after < worst.after) worst = { date: p.dueOn, before, after };
  }
  return worst!;
}

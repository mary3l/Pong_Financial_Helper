import { addDays, dateInMonth, daysBetween } from "@/lib/dates";
import { roundCents } from "@/lib/money";
import { nextOccurrence, occurrences, type Schedule } from "@/lib/schedule";

// The forecast (design canvas 3.1), Safe to spend and "Can I afford this?".
// Pure, so the server and the browser share it.
//
// Only cash, bank and e-wallet money is counted. Scheduled items count until
// they're logged ("Mark paid" or "Add income"): then the wallet balance
// already reflects them and the item drops out.

export type ForecastKind = "payday" | "income" | "bill" | "planned" | "installment" | "utang" | "pautang";

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
  /** The day that transaction happened, when known: before `dueOn` means it was paid in advance. */
  paidOn?: string | null;
  /** Installments: the credit line or loan it pays. */
  lenderId?: string | null;
  /** Installments: the plan's last payment. */
  lastPayment?: boolean;
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
  paydayAmounts?: Record<string, { amount: number; estimate: boolean }>;
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
  }[];
};

/** The category a recurring item logs under when it has none saved. */
export function recurringCategory(r: { kind: "payday" | "bill" | "income"; category: string | null }): string {
  if (r.category) return r.category;
  return r.kind === "bill" ? "bills" : r.kind === "payday" ? "salary" : "other_income";
}

/**
 * Every payday, recurring item and planned item from `from` up to but not
 * including `until`, by date. Unlogged planned items from before `from` are
 * included too, since they're still expected.
 */
export function scheduledItems(
  { recurring, billPayments, planned, installments = [], paydayAmounts = {} }: ScheduleInputs,
  from: string,
  until: string,
): ForecastItem[] {
  const logged = new Map(billPayments.map((p) => [`${p.recurringItemId}|${p.dueOn}`, p.transactionId]));
  const items: ForecastItem[] = [];

  for (const r of recurring) {
    const end = r.endsOn && r.endsOn < until ? addDays(r.endsOn, 1) : until;
    for (const date of occurrences(r, from, end)) {
      const payroll = r.kind === "payday" ? paydayAmounts[date] : undefined;
      items.push({
        key: `${r.kind}|${r.id}|${date}`,
        kind: r.kind,
        flow: r.kind === "bill" ? "out" : "in",
        id: r.id,
        name: r.kind === "payday" ? "Payday" : r.name,
        amount: payroll ? payroll.amount : r.amount,
        dueOn: date,
        accountId: r.accountId,
        category: recurringCategory(r),
        estimate: payroll ? payroll.estimate : r.amountVaries,
        transactionId: logged.get(`${r.id}|${date}`) ?? null,
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
export function paidInAdvance(item: Pick<ForecastItem, "flow" | "transactionId" | "paidOn" | "dueOn">): boolean {
  return item.flow === "out" && Boolean(item.transactionId) && Boolean(item.paidOn) && item.paidOn! < item.dueOn;
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
    .map((item) => ({ item, date: item.dueOn < from ? from : item.dueOn, change: itemEffect(item) }))
    .filter((e) => e.date < until && (e.change !== 0 || (e.item.kind === "payday" && e.item.amount === null)))
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
    while (i < events.length && events[i].date === date) balance = roundCents(balance + events[i++].change);
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

export type SafeToSpend = {
  /** Spendable money across cash, bank and e-wallets. */
  inWallets: number;
  /** Unpaid bills and planned expenses from today until the day before payday. */
  dueBeforePayday: number;
  dueCount: number;
  nextPayday: string | null;
  /** Days from today until payday, counting today. */
  daysLeft: number | null;
  /**
   * Weekly pay: money held back now for bills after payday that the pays
   * before them can't cover. 0 for pay twice a month or monthly.
   */
  setAsideLater: number;
  /** Wallet money minus what's due and what's held back, never below 0. */
  free: number;
  /** What's free per day until payday, from the start of today; null without a payday. */
  perDay: number | null;
  /** Spent from spending wallets today, not counting bills and planned items. */
  spentToday: number;
  /** Today's share minus what you've spent today. Below 0 when you went over; null without a payday. */
  leftToday: number | null;
};

/**
 * Safe to spend: wallet money at the start of today, minus unpaid bills and
 * planned expenses due before the next payday, spread over the days until
 * then. What you spend today comes out of today's share, so the daily amount
 * holds still all day. Pautang, credit limits and loans never count.
 */
export function safeToSpend({
  inWallets,
  payday,
  items,
  today,
  spentToday = 0,
}: {
  /** Spending money in your wallets right now. */
  inWallets: number;
  payday: Schedule | null;
  items: ForecastItem[];
  today: string;
  spentToday?: number;
}): SafeToSpend {
  spentToday = roundCents(spentToday);
  if (!payday) {
    return {
      inWallets,
      dueBeforePayday: 0,
      dueCount: 0,
      nextPayday: null,
      daysLeft: null,
      setAsideLater: 0,
      free: inWallets,
      perDay: null,
      spentToday,
      leftToday: null,
    };
  }
  const nextPayday = nextOccurrence(payday, today);
  const daysLeft = daysBetween(today, nextPayday);
  const due = items.filter((i) => isOwed(i) && i.amount !== null && i.dueOn < nextPayday);
  const dueBeforePayday = roundCents(due.reduce((sum, i) => sum + i.amount!, 0));
  const freeUntilPayday = Math.max(0, roundCents(inWallets + spentToday - dueBeforePayday));
  const setAsideLater =
    payday.frequency === "weekly"
      ? heldBackForLater({ freeUntilPayday, startOfDay: roundCents(inWallets + spentToday), daysLeft, items, today, nextPayday })
      : 0;
  const free = roundCents(freeUntilPayday - setAsideLater);
  const perDay = Math.floor(free / daysLeft);
  return {
    inWallets,
    dueBeforePayday,
    dueCount: due.length,
    nextPayday,
    daysLeft,
    setAsideLater,
    free,
    perDay,
    spentToday,
    leftToday: roundCents(perDay - spentToday),
  };
}

/** How far ahead weekly pay looks: about a month of bills, within the 30 days Home reads. */
export const WEEKLY_LOOK_AHEAD_DAYS = 30;

/**
 * Weekly pay: a week's pay often can't cover the rent or a loan due later in
 * the month, so dividing everything by the days until Friday would let you
 * spend money those bills need. Spending the same amount every day, each
 * day's balance must stay at or above ₱0 counting only the pay that has come
 * in by then: perDay ≤ balance(t) ÷ days from today through t, for every day
 * t in the next month. What that holds back beyond the bills before payday
 * is returned. Pay only ever lowers what's held back, never raises Safe to
 * spend above what's in your wallets now, so income you haven't received
 * still never counts. A payday with no amount saved counts as ₱0.
 */
function heldBackForLater({
  freeUntilPayday,
  startOfDay,
  daysLeft,
  items,
  today,
  nextPayday,
}: {
  freeUntilPayday: number;
  startOfDay: number;
  daysLeft: number;
  items: ForecastItem[];
  today: string;
  nextPayday: string;
}): number {
  const untilPayday = freeUntilPayday / daysLeft;
  let limit = untilPayday;
  // From payday on, both money in and money out count, by date (late items today).
  const after = items
    .map((i) => ({ date: i.dueOn < today ? today : i.dueOn, change: itemEffect(i) }))
    .filter((e) => e.change !== 0);
  const last = addDays(today, WEEKLY_LOOK_AHEAD_DAYS - 1);
  for (let t = nextPayday; t <= last; t = addDays(t, 1)) {
    const balance = after.filter((e) => e.date <= t && (e.change < 0 || e.date >= nextPayday)).reduce((sum, e) => sum + e.change, startOfDay);
    limit = Math.min(limit, Math.max(0, balance) / (daysBetween(today, t) + 1));
  }
  // Only later bills hold anything back; the cents left over from ÷ days stay free.
  if (Math.floor(limit) >= Math.floor(untilPayday)) return 0;
  return roundCents(freeUntilPayday - Math.floor(limit) * daysLeft);
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
  const each = Math.floor((amount / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? roundCents(amount - each * (count - 1)) : each,
  );
}

export type Purchase = { name: string; amount: number; first: string; months: number };

/** The purchase as planned expenses: one, or one per installment. */
export function purchaseItems(p: Purchase): ForecastItem[] {
  const amounts = splitAmount(p.amount, p.months);
  return monthlyDates(p.first, p.months).map((date, i) => ({
    key: `purchase|${i}`,
    kind: "planned",
    flow: "out",
    id: `purchase-${i}`,
    name: p.months > 1 ? `${p.name} (${i + 1} of ${p.months})` : p.name,
    amount: amounts[i],
    dueOn: date,
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
  }));
}

export type Verdict = {
  tone: "comfortable" | "tight" | "wait" | "no";
  title: string;
  before: Projection;
  after: Projection;
  /** For "wait": the payday that makes it work. */
  waitUntil?: string;
};

/**
 * Tests a purchase against the forecast. Tight means the low point after
 * buying is under half of what it was.
 */
export function affordVerdict({
  start,
  items,
  purchase,
  today,
  nextPayday,
}: {
  start: number;
  items: ForecastItem[];
  purchase: Purchase;
  today: string;
  nextPayday: string | null;
}): Verdict {
  const last = monthlyDates(purchase.first, purchase.months).at(-1)!;
  const length = Math.min(400, Math.max(60, daysBetween(today, last) + 31));
  const before = project(start, items, today, length);
  const after = project(start, [...items, ...purchaseItems(purchase)], today, length);
  const low = after.lowest.balance;

  if (low >= 0) {
    const tight = low === 0 || low < before.lowest.balance * 0.5;
    return { tone: tight ? "tight" : "comfortable", title: tight ? "Yes, but tight" : "Yes, comfortably", before, after };
  }
  if (nextPayday && purchase.first < nextPayday && before.lowest.balance >= 0) {
    const later = project(start, [...items, ...purchaseItems({ ...purchase, first: nextPayday })], today, length);
    if (later.lowest.balance >= 0) {
      return { tone: "wait", title: "Wait until payday", before, after, waitUntil: nextPayday };
    }
  }
  return { tone: "no", title: "No, you'd go below ₱0", before, after };
}

import { addDays, daysBetween, daysInMonth, isValidDate, weekdayOf } from "@/lib/dates";
import { isOwed, type ForecastItem } from "@/lib/forecast";
import { roundCents } from "@/lib/money";
import { buildPaymentPlan, isBnplBill, PLAN_FLOOR, type PaymentPlan } from "@/lib/payment-plan";

// Plan › Payments › Calendar: pick the day you'll pay each loan payment, up
// to its due date. Each one you lock comes out of the plan on that day, so
// the days that are still safe for the others move with it. A day is safe
// when paying then keeps every day until it's due at PLAN_FLOOR or more.
// Pure, so the browser can use it too.

/** Item key → the day you'll pay it. */
export type Locks = Record<string, string>;

/** Where locks are remembered on this device. */
export const PAY_AHEAD_KEY = "pong.payAhead";

/**
 * Payments you can pay ahead, unpaid and due after today: loan payments,
 * bills you pay yourself (like a phone plan), and utang you owe someone by a
 * date (paying it settles the whole balance). Not BNPL bills, which wait for
 * their due day; not bills the payroll calculator takes from your pay; not
 * planned spending, which happens on its day.
 */
export function aheadCandidates(
  items: ForecastItem[],
  creditLineIds: Set<string>,
  today: string,
): ForecastItem[] {
  return items.filter(
    (i) =>
      (i.kind === "installment" || i.kind === "utang" || (i.kind === "bill" && !i.fromPayroll)) &&
      isOwed(i) &&
      i.amount !== null &&
      i.dueOn > today &&
      !isBnplBill(i, creditLineIds),
  );
}

/** Saved locks, or none when they're missing or broken. */
export function parseLocks(raw: string | null): Locks {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, d]) => isValidDate(d))) as Locks;
  } catch {
    return {};
  }
}

/** Only locks for payments still to pay, from today until the day before each is due. */
export function cleanLocks(locks: Locks, candidates: ForecastItem[], today: string): Locks {
  const out: Locks = {};
  for (const item of candidates) {
    const date = locks[item.key];
    if (date && date >= today && date < item.dueOn) out[item.key] = date;
  }
  return out;
}

/** The items with each locked one moved to its day. */
export function withLocks(items: ForecastItem[], locks: Locks): ForecastItem[] {
  return items.map((i) => (locks[i.key] ? { ...i, dueOn: locks[i.key] } : i));
}

/** The payment plan with your locks; `held` is the BNPL caps, which stay on their bill days. */
export function planWithLocks({
  start,
  items,
  held,
  locks,
  today,
}: {
  start: number;
  items: ForecastItem[];
  held: ForecastItem[];
  locks: Locks;
  today: string;
}): PaymentPlan {
  return buildPaymentPlan({ start, items: [...withLocks(items, locks), ...held], today });
}

export type DayCheck = {
  safe: boolean;
  /** The lowest your wallets get from that day until it's due, paying it then. Null on its due day. */
  low: number | null;
  lowOn: string | null;
};

/**
 * Paying `item` on `date` instead of where it is now (its lock, or its due
 * date): the lowest end-of-day balance from that day until the day before
 * it's due, keeping the plan's daily amounts. Its due day is always safe.
 */
export function checkDay(
  item: ForecastItem,
  date: string,
  plan: PaymentPlan,
  locks: Locks,
  today: string,
): DayCheck {
  const amount = item.amount ?? 0;
  const from = daysBetween(today, date);
  const until = Math.min(daysBetween(today, item.dueOn), plan.days.length);
  // Days from its lock until it's due already have it taken out.
  const lockedFrom = daysBetween(today, locks[item.key] ?? item.dueOn);
  let low = Infinity;
  let lowOn: string | null = null;
  for (let t = Math.max(0, from); t < until; t++) {
    const balance = roundCents(plan.days[t].balance + (t >= lockedFrom ? amount : 0) - amount);
    if (balance < low) {
      low = balance;
      lowOn = plan.days[t].date;
    }
  }
  if (lowOn === null) return { safe: true, low: null, lowOn: null };
  return { safe: low >= PLAN_FLOOR, low, lowOn };
}

/** The first safe day to pay `item`, from today; its due date when no earlier day is. */
export function firstSafeDay(
  item: ForecastItem,
  plan: PaymentPlan,
  locks: Locks,
  today: string,
): string {
  for (const day of plan.days) {
    if (day.date >= item.dueOn) break;
    if (checkDay(item, day.date, plan, locks, today).safe) return day.date;
  }
  return item.dueOn;
}

/** A month ("2026-11") as calendar cells from Sunday: null before the 1st, then each date. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const dates = Array.from({ length: daysInMonth(y, m) }, (_, i) => addDays(first, i));
  return [...Array.from({ length: weekdayOf(first) }, () => null), ...dates];
}

/** The month after (+1) or before (−1) `month`. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

import { addDays, daysBetween } from "@/lib/dates";
import { itemEffect, type DayBalance, type ForecastItem } from "@/lib/forecast";
import { bnplFirstDue } from "@/lib/installments";
import { roundCents } from "@/lib/money";

// The payment plan: how much you can spend each day so every bill, loan and
// BNPL payment is paid on time and your wallets never drop under PLAN_FLOOR.
// Pong picks the amount, not you. BNPL has its own cap on each bill, held on
// the bill's due day. Pure, so the browser can use it too.

/** Always kept in your spending wallets. */
export const PLAN_FLOOR = 1000;
/** How far ahead the plan looks. */
export const PLAN_DAYS = 90;
/** Daily amounts are rounded down to this. */
const ROUND_TO = 10;
/** A gap with nothing to pay at least this long gets a "Breathe" line. */
export const BREATHE_DAYS = 5;

/** One stretch of days with the same daily amount. `until` is the first day after it. */
export type PlanSegment = { from: string; until: string; perDay: number };

export type PaymentPlan = {
  /** Non-decreasing daily amounts, from today to the end of the plan. */
  segments: PlanSegment[];
  /** Today's amount. */
  perDay: number;
  /** End-of-day balance in your spending wallets, spending the plan's amount every day. */
  days: DayBalance[];
  /** The lowest day of the first stretch: what sets today's amount. */
  lowest: DayBalance;
  /** How much over today's amount you can go before the plan has to change. */
  cushion: number;
  /** Even spending nothing, a bill would take you under the floor. */
  short: boolean;
};

/**
 * Builds the plan from the money in your spending wallets at the start of
 * today. Each stretch gets the most you can spend a day without any day
 * ending under PLAN_FLOOR, counting every item by its date (late ones today);
 * the day that limits it ends the stretch, and the next one starts from
 * what's left. So the amount only goes up, after the tight days are past.
 */
export function buildPaymentPlan({
  start,
  items,
  today,
  days = PLAN_DAYS,
}: {
  /** Spending money at the start of today. */
  start: number;
  items: ForecastItem[];
  today: string;
  days?: number;
}): PaymentPlan {
  const change = dailyChanges(items, today, days);
  const segments: PlanSegment[] = [];
  let balance = start;
  let short = false;
  for (let s = 0; s < days; ) {
    let cum = 0;
    let best = Infinity;
    let end = s;
    for (let t = s; t < days; t++) {
      cum += change[t];
      const most = (balance + cum - PLAN_FLOOR) / (t - s + 1);
      // The latest day with the lowest limit, so a stretch runs as long as it can.
      if (most <= best) {
        best = most;
        end = t;
      }
    }
    if (best < 0) short = true;
    const perDay = Math.max(0, Math.floor(best / ROUND_TO) * ROUND_TO);
    const last = segments.at(-1);
    if (last && last.perDay === perDay) last.until = addDays(today, end + 1);
    else segments.push({ from: addDays(today, s), until: addDays(today, end + 1), perDay });
    for (let t = s; t <= end; t++) balance += change[t] - perDay;
    s = end + 1;
  }

  const balances = endOfDay(start, change, segments, today, days);
  const firstEnd = daysBetween(today, segments[0].until);
  const lowest = balances.slice(0, firstEnd).reduce((low, d) => (d.balance < low.balance ? d : low), balances[0]);
  return {
    segments,
    perDay: segments[0].perDay,
    days: balances,
    lowest,
    cushion: roundCents(Math.max(0, lowest.balance - PLAN_FLOOR)),
    short,
  };
}

/** What each day's items do to your wallets, day 0 being today. */
function dailyChanges(items: ForecastItem[], today: string, days: number): number[] {
  const change = new Array<number>(days).fill(0);
  for (const item of items) {
    const effect = itemEffect(item);
    if (!effect) continue;
    const d = item.dueOn < today ? 0 : daysBetween(today, item.dueOn);
    if (d < days) change[d] += effect;
  }
  return change;
}

function endOfDay(start: number, change: number[], segments: PlanSegment[], today: string, days: number): DayBalance[] {
  const out: DayBalance[] = [];
  let balance = start;
  for (let d = 0; d < days; d++) {
    const date = addDays(today, d);
    const perDay = segments.find((s) => date >= s.from && date < s.until)?.perDay ?? 0;
    balance = roundCents(balance + change[d] - perDay);
    out.push({ date, balance });
  }
  return out;
}

/**
 * The first day you can pay `item` without any day before its due date
 * ending under PLAN_FLOOR, keeping the plan's daily amounts. Today when it's
 * safe now (or already due); its own due date when no earlier day is.
 */
export function earliestToPay(item: ForecastItem, plan: PaymentPlan, today: string): string {
  if (item.flow !== "out" || item.amount === null || item.transactionId || item.dueOn <= today) return today;
  const due = daysBetween(today, item.dueOn);
  let low = Infinity;
  let earliest = item.dueOn;
  // Paying on day p lowers every day from p until the due date.
  for (let p = Math.min(due, plan.days.length) - 1; p >= 0; p--) {
    low = Math.min(low, plan.days[p].balance);
    if (low - item.amount < PLAN_FLOOR) break;
    earliest = plan.days[p].date;
  }
  return earliest;
}

/** The stretch after today's, when the amount goes up. */
export function nextSegment(plan: PaymentPlan): PlanSegment | null {
  return plan.segments[1] ?? null;
}

/**
 * Tomorrow's amount once today is over: today's items done, and the cash you
 * actually spent today taken out instead of today's amount. BNPL bought
 * today isn't cash: its bill is in `items`, so it's held back from then on.
 */
export function tomorrowsAmount({
  start,
  items,
  today,
  cashSpentToday,
  days = PLAN_DAYS,
}: {
  start: number;
  /** Every item, including the bills for what you put on BNPL today. */
  items: ForecastItem[];
  today: string;
  cashSpentToday: number;
  days?: number;
}): number {
  const todays = items
    .filter((i) => i.dueOn <= today)
    .reduce((sum, i) => sum + itemEffect(i), 0);
  return buildPaymentPlan({
    start: roundCents(start + todays - cashSpentToday),
    items: items.filter((i) => i.dueOn > today),
    today: addDays(today, 1),
    days: days - 1,
  }).perDay;
}

// ── BNPL caps ───────────────────────────────────────────────────────────

/** BNPL gets at most this share of what you can spend each day; cash gets the rest. */
export const BNPL_SHARE = 0.2;

/** A BNPL line with a due day, and what you've put on it since its current bill started. */
export type CapLine = {
  id: string;
  name: string;
  dueDay: number;
  cutoffDay: number | null;
  /** Limit minus what you owe; null without a limit. */
  creditLeft: number | null;
  /** Your own purchases on it since the start of the bill today's buys land on. */
  used: number;
};

/** The days whose purchases land on one bill. `until` is the first day after them. */
export type BillCycle = { lineId: string; due: string; from: string; until: string; days: number };

/** Each bill a line has from the one today's buys land on, while it's due within `days`. */
export function billCycles(line: Pick<CapLine, "id" | "dueDay" | "cutoffDay">, today: string, days = PLAN_DAYS): BillCycle[] {
  const end = addDays(today, days);
  const byDue = new Map<string, BillCycle>();
  // A cycle is a month at most, so 40 days back finds the start of today's.
  for (let d = -40; d < days; d++) {
    const date = addDays(today, d);
    const due = bnplFirstDue(date, line.dueDay, line.cutoffDay);
    const cycle = byDue.get(due);
    if (cycle) {
      cycle.until = addDays(date, 1);
      cycle.days += 1;
    } else byDue.set(due, { lineId: line.id, due, from: date, until: addDays(date, 1), days: 1 });
  }
  return [...byDue.values()].filter((c) => c.until > today && c.due < end);
}

/** The cap on new purchases for one bill. */
export type BillCap = BillCycle & {
  name: string;
  /** The most you can put on it for this bill. */
  cap: number;
  /** Already on it (today's bill only). */
  used: number;
  /** What's left, within the line's credit left. */
  left: number;
};

export type CappedPlan = {
  plan: PaymentPlan;
  /** Each line's cap per day of a bill cycle. */
  perDay: number;
  /** Every bill's cap, soonest first. */
  caps: BillCap[];
  /** The caps still open, held on their bill days. */
  held: ForecastItem[];
};

/**
 * The plan with room for BNPL: each line may add up to `perDay` for every
 * day of a bill cycle, and what's still open of that is held on the bill's
 * due day like a bill. Pong picks `perDay` so all the lines together get at
 * most BNPL_SHARE of what you can spend each day, cash the rest.
 */
export function cappedPlan({
  start,
  items,
  today,
  lines,
}: {
  start: number;
  items: ForecastItem[];
  today: string;
  lines: CapLine[];
}): CappedPlan {
  const cycles = lines.flatMap((line) => billCycles(line, today).map((c) => ({ line, c })));
  const build = (rate: number) => {
    const caps: BillCap[] = cycles.map(({ line, c }) => {
      const cap = rate * c.days;
      const used = c.from <= today ? line.used : 0;
      const left = roundCents(Math.max(0, Math.min(cap - used, line.creditLeft ?? Infinity)));
      return { ...c, name: line.name, cap, used, left };
    });
    const held: ForecastItem[] = caps
      .filter((c) => c.left > 0)
      .map((c) => ({
        key: `cap|${c.lineId}|${c.due}`,
        kind: "planned",
        flow: "out",
        id: `cap-${c.lineId}-${c.due}`,
        name: `${c.name} · new buys`,
        amount: c.left,
        dueOn: c.due,
        accountId: null,
        category: null,
        estimate: true,
        transactionId: null,
        lenderId: c.lineId,
      }));
    return { plan: buildPaymentPlan({ start, items: [...items, ...held], today }), caps, held };
  };
  const fits = (rate: number) => {
    const { plan } = build(rate);
    return !plan.short && lines.length * rate <= (BNPL_SHARE / (1 - BNPL_SHARE)) * plan.perDay;
  };
  let lo = 0;
  if (cycles.length && fits(1)) {
    let hi = 2;
    while (fits(hi) && hi < 100000) hi *= 2;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
  }
  return { ...build(lo), perDay: lo };
}

export type PlanToday = {
  plan: PaymentPlan;
  /** Spending money at the start of today. */
  start: number;
  /** Cash spent today. BNPL comes out of its caps, not this. */
  cash: number;
  /** Today's amount minus the cash you spent. Below 0 when you went over. */
  left: number;
  /** Past the cushion: tomorrow's lower amount. Null while the plan still holds. */
  tomorrow: number | null;
  /** BNPL caps per bill, and each line's cap per day. */
  caps: BillCap[];
  capPerDay: number;
  /** The open caps, held on their bill days. */
  held: ForecastItem[];
};

/**
 * Today on the plan. The plan starts from this morning, before today's cash
 * spending. BNPL doesn't come out of today's amount: each line has a cap per
 * bill, held on its due day, and what you buy fills it.
 */
export function planToday({
  inWallets,
  cash,
  items,
  today,
  lines = [],
}: {
  /** Spending money in your wallets right now. */
  inWallets: number;
  cash: number;
  items: ForecastItem[];
  today: string;
  lines?: CapLine[];
}): PlanToday {
  const start = roundCents(inWallets + cash);
  const { plan, caps, held, perDay } = cappedPlan({ start, items, today, lines });
  const left = roundCents(plan.perDay - cash);
  const tomorrow =
    -left > plan.cushion ? tomorrowsAmount({ start, items: [...items, ...held], today, cashSpentToday: cash }) : null;
  return { plan, start, cash, left, tomorrow, caps, capPerDay: perDay, held };
}

/** A line's BNPL bill: Pay only on its due day, never early. */
export function isBnplBill(item: ForecastItem, creditLineIds: Set<string>): boolean {
  return item.flow === "out" && Boolean(item.lenderId && creditLineIds.has(item.lenderId));
}

/** Days with something to pay or receive, with the gaps between them long enough to breathe. */
export function breathers(dates: string[], today: string): { after: string | null; from: string; until: string; days: number }[] {
  const sorted = [...new Set(dates)].sort();
  const out: { after: string | null; from: string; until: string; days: number }[] = [];
  let prev: string | null = null;
  for (const date of sorted) {
    const from: string = prev ? addDays(prev, 1) : today;
    const gap = daysBetween(from, date);
    if (gap >= BREATHE_DAYS) out.push({ after: prev, from, until: date, days: gap });
    prev = date;
  }
  return out;
}

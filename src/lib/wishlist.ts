import { affordWithCredit, type BnplCap, type CreditRoom } from "@/lib/bnpl";
import { addDays, formatShortDay } from "@/lib/dates";
import { monthlyDates, splitAmount, type ForecastItem } from "@/lib/forecast";
import { formatPeso } from "@/lib/money";
import { affordVerdict, type Verdict } from "@/lib/payment-plan";
import { occurrences, type Schedule } from "@/lib/schedule";

// Plan › Wishlist: plans you're thinking about, where Pong picks the date and
// the way to pay that hurts your daily amount least. Each one is checked on
// its own against your real forecast, never assuming you'll do the others:
// they're only ideas until you make one real. Pure, so it's testable.

/** How far ahead Pong looks without a "by" date, and at most. */
export const WINDOW_DAYS = 365;
/** Dates checked per plan at most; a daily or weekly payday is thinned to this. */
export const MAX_DATES = 26;
/** Borrowing has to spare your daily amount by this much more than paying from your own money. */
export const BORROW_MARGIN = 0.1;

const INSTALLMENT_MONTHS = [3, 6, 12] as const;
/** Monthly parts from your wallets at most, like Can I afford this?. */
export const MAX_PARTS = 24;
const CREDIT_MONTHS = [1, 3, 6, 12] as const;

export type Wish = {
  id: string;
  name: string;
  amount: number;
  category: string;
  /** The start date: nothing is paid before it. */
  earliest: string;
  /** Pay off by: every payment from your wallets is on or before it. Null for a year on. */
  by: string | null;
  /** If it goes on a card or BNPL: the fee in % a month. */
  feeRate: number;
};

export type Strategy =
  /** Save up and pay it all from your wallets on the date. */
  | { kind: "full" }
  /** Monthly parts from your wallets, the first on the date and the last by the "pay off by" date. */
  | { kind: "installments"; months: number }
  /** On a card or BNPL bought on the date, paid back on its due days. */
  | { kind: "credit"; lineId: string; months: number };

export type WishPick = {
  /** The day you buy it (or the first part, from your wallets). */
  date: string;
  strategy: Strategy;
  /** When and how, start to end: "₱3,000 a month, Feb 11 → Jul 11, 2028 (6 payments)". */
  label: string;
  verdict: Verdict;
  /** What leaves your wallets and when, fees included. */
  payments: { dueOn: string; amount: number }[];
  fees: number;
  /** The biggest share of a day's amount it takes away, 0 to 1. */
  cut: number;
  borrowed: boolean;
  /** Paying in full: what to put aside each payday until then. Null without a payday before it. */
  setAside: { perPayday: number; paydays: number } | null;
};

export type WishResult = {
  /** Pong's pick; null when nothing fits in the window. */
  best: WishPick | null;
  /** The next best ways that differ from the pick, at most 2. */
  others: WishPick[];
  /** One sentence on why. */
  why: string;
  window: { from: string; last: string };
};

/** The dates Pong looks between: from `earliest` (or today), to `by` or a year on, never past a year from today. */
export function windowOf(wish: Pick<Wish, "earliest" | "by">, today: string) {
  const from = wish.earliest > today ? wish.earliest : today;
  const cap = addDays(today, WINDOW_DAYS);
  let last = wish.by ?? addDays(from, WINDOW_DAYS);
  if (last > cap) last = cap;
  if (last < from) last = from;
  return { from, last };
}

/** The first day of the window, each payday in it (or each month without one), and its last day; at most MAX_DATES. */
export function candidateDates(
  wish: Pick<Wish, "earliest" | "by">,
  today: string,
  payday: Schedule | null,
): string[] {
  const { from, last } = windowOf(wish, today);
  const inside = payday
    ? occurrences(payday, addDays(from, 1), addDays(last, 1))
    : monthlyDates(from, 13).filter((d) => d > from && d <= last);
  const dates = [...new Set([from, ...inside, last])].sort();
  if (dates.length <= MAX_DATES) return dates;
  // Evenly spread, keeping the first and last.
  const step = (dates.length - 1) / (MAX_DATES - 1);
  return [...new Set(Array.from({ length: MAX_DATES }, (_, i) => dates[Math.round(i * step)]))];
}

/** The biggest share of a day's amount the purchase takes away. */
function cutOf(v: Verdict): number {
  const c = v.biggestCut;
  return c && c.before > 0 ? Math.max(0, (c.before - c.after) / c.before) : 0;
}

const TONE_RANK: Record<Verdict["tone"], number> = { comfortable: 0, tight: 1, wait: 2, no: 3 };

/** How much a pick hurts, for when none is comfortable: its cut, plus BORROW_MARGIN if it's borrowed, plus its fees' share. */
export function ouch(p: WishPick, amount: number): number {
  return p.cut + (p.borrowed ? BORROW_MARGIN : 0) + (amount > 0 ? p.fees / amount : 0);
}

/**
 * Sorts the gentlest first. A comfortable pick beats a tight one. Among
 * comfortable ones: your own money before borrowing, fewer fees, the soonest
 * date, paying in full before parts, then the smaller cut. (Not the smallest
 * cut first: waiting longer nearly always cuts less, and you want it when
 * it's comfortable, not as late as possible.) Among tight ones: the least
 * ouch, then the soonest.
 */
export function gentler(a: WishPick, b: WishPick, amount: number): number {
  const tone = TONE_RANK[a.verdict.tone] - TONE_RANK[b.verdict.tone];
  if (tone) return tone;
  if (a.verdict.tone === "comfortable") {
    return (
      Number(a.borrowed) - Number(b.borrowed) ||
      a.fees - b.fees ||
      a.date.localeCompare(b.date) ||
      Number(a.strategy.kind !== "full") - Number(b.strategy.kind !== "full") ||
      a.cut - b.cut
    );
  }
  return ouch(a, amount) - ouch(b, amount) || a.date.localeCompare(b.date);
}

/** Paying in full on `date`: the amount split over the paydays from tomorrow up to that day. */
export function setAsideFor(
  amount: number,
  date: string,
  today: string,
  payday: Schedule | null,
): WishPick["setAside"] {
  if (!payday) return null;
  const paydays = occurrences(payday, addDays(today, 1), addDays(date, 1)).length;
  return paydays ? { perPayday: Math.ceil(amount / paydays), paydays } : null;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

function strategyKey(s: Strategy): string {
  return s.kind === "credit" ? `credit|${s.lineId}` : s.kind;
}

/**
 * Pong's pick for one plan: every date in the window paid in full from your
 * wallets, then installments and each card or BNPL line (with the plan's fee,
 * within limits and Pong's cap) on the first date and the two best dates.
 * The gentlest wins (see `gentler`): the soonest comfortable way, from your
 * own money if it can be.
 */
export function bestPicks({
  wish,
  start,
  items,
  today,
  payday,
  credit,
  cap,
}: {
  wish: Wish;
  /** Spending money in your wallets now. */
  start: number;
  /** The real forecast: never other wishes. */
  items: ForecastItem[];
  today: string;
  payday: Schedule | null;
  credit: CreditRoom[];
  cap: BnplCap | null;
}): WishResult {
  const window = windowOf(wish, today);
  const dates = candidateDates(wish, today, payday);
  const purchase = (first: string, months: number) => ({
    name: wish.name,
    amount: wish.amount,
    first,
    months,
  });
  const day = (d: string) => formatShortDay(d, today);
  /** "Feb 11 → Jul 11, 2028": the year once when both share it. */
  const span = (a: string, b: string) =>
    a.slice(0, 4) === b.slice(0, 4) && a.slice(0, 4) !== today.slice(0, 4)
      ? `${formatShortDay(a, a)} → ${day(b)}`
      : `${day(a)} → ${day(b)}`;
  const fromWallets = (date: string, months: number): WishPick => {
    const verdict = affordVerdict({
      start,
      items,
      purchase: purchase(date, months),
      today,
      nextPayday: null,
    });
    const amounts = splitAmount(wish.amount, months);
    const dueOns = monthlyDates(date, months);
    return {
      date,
      strategy: months > 1 ? { kind: "installments", months } : { kind: "full" },
      label:
        months > 1
          ? `${formatPeso(amounts[0])} a month, ${span(date, dueOns.at(-1)!)} (${months} payments)`
          : `Pay ${formatPeso(wish.amount)} on ${day(date)} from your wallets`,
      verdict,
      payments: dueOns.map((dueOn, i) => ({ dueOn, amount: amounts[i] })),
      fees: 0,
      cut: cutOf(verdict),
      borrowed: false,
      setAside: months > 1 ? null : setAsideFor(wish.amount, date, today, payday),
    };
  };

  const byOuch = (a: WishPick, b: WishPick) => gentler(a, b, wish.amount);

  const full = dates.map((d) => fromWallets(d, 1));
  const focus = [
    ...new Set([
      dates[0],
      ...[...full]
        .sort(byOuch)
        .slice(0, 2)
        .map((p) => p.date),
    ]),
  ];

  const spread: WishPick[] = [];
  for (const date of focus) {
    // Parts from your wallets end by the "pay off by" date: 3, 6 or 12 if
    // they fit, and as many as fit, so the whole window can be used.
    const fit = partsThatFit(date, window.last);
    const parts = new Set([...INSTALLMENT_MONTHS.filter((m) => m <= fit), fit]);
    for (const months of parts) if (months > 1) spread.push(fromWallets(date, months));
    if (!credit.length) continue;
    for (const months of CREDIT_MONTHS) {
      const options = affordWithCredit({
        start,
        items,
        purchase: purchase(date, months),
        today,
        payday,
        lines: credit,
        cap,
        ratePerMonth: wish.feeRate,
      });
      for (const o of options) {
        if (!o.verdict) continue;
        const bills = o.payments.map((p) => p.dueOn);
        spread.push({
          date,
          strategy: { kind: "credit", lineId: o.line.id, months },
          // You buy it on the date; the card's bills come after, on its due days.
          label:
            months > 1
              ? `Buy ${day(date)} on ${o.line.name}, then ${formatPeso(o.payment)} a month, ${span(bills[0], bills.at(-1)!)}`
              : `Buy ${day(date)} on ${o.line.name}, one bill of ${formatPeso(o.payment)} on ${day(bills[0])}`,
          verdict: o.verdict,
          payments: o.payments.map((p) => ({ dueOn: p.dueOn, amount: p.amount })),
          fees: o.fees,
          cut: cutOf(o.verdict),
          borrowed: true,
          setAside: null,
        });
      }
    }
  }

  const ranked = [...full, ...spread].filter((p) => p.verdict.tone !== "no").sort(byOuch);
  const best = ranked[0] ?? null;
  const others: WishPick[] = [];
  const seen = new Set(best ? [strategyKey(best.strategy)] : []);
  for (const p of ranked.slice(1)) {
    if (others.length === 2) break;
    const key = strategyKey(p.strategy);
    if (seen.has(key)) continue;
    seen.add(key);
    others.push(p);
  }
  return { best, others, why: whyText(best, full, window, today), window };
}

/** How many monthly parts from `first` end on or before `last`, up to MAX_PARTS. */
export function partsThatFit(first: string, last: string): number {
  const dates = monthlyDates(first, MAX_PARTS);
  const n = dates.findIndex((d) => d > last);
  return n === -1 ? MAX_PARTS : n;
}

function whyText(
  best: WishPick | null,
  full: WishPick[],
  window: { from: string; last: string },
  today: string,
): string {
  const day = (d: string) => formatShortDay(d, today);
  if (!best) {
    return `Nothing fits from ${day(window.from)} to ${day(window.last)} without leaving your wallets short. Try a later "pay off by" date, or a smaller amount.`;
  }
  const fullBest = full.filter((p) => p.verdict.tone !== "no").sort((a, b) => a.cut - b.cut)[0];
  if (best.strategy.kind === "credit") {
    return fullBest
      ? `This cuts your daily amount by ${pct(best.cut)}, against ${pct(fullBest.cut)} paying it all at once.`
      : `Paying it all at once doesn't fit by ${day(window.last)}, so spreading it out on credit does.`;
  }
  if (best.strategy.kind === "installments") {
    return fullBest
      ? `Spread over ${best.strategy.months} months it cuts your daily amount by ${pct(best.cut)}, against ${pct(fullBest.cut)} all at once.`
      : `All at once doesn't fit by ${day(window.last)}, but ${best.strategy.months} monthly parts do.`;
  }
  const first = full[0];
  if (best.date === first.date) {
    return best.cut === 0
      ? `It fits on ${day(best.date)} without changing your daily amount.`
      : `It fits on ${day(best.date)}, though your daily amount drops ${pct(best.cut)} for a while.`;
  }
  const gently = best.verdict.tone === "comfortable" ? "fits comfortably" : "fits, though tight";
  return first.verdict.tone === "no"
    ? `It doesn't fit on ${day(first.date)}. ${day(best.date)} is the soonest it ${gently}.`
    : `On ${day(first.date)} your daily amount would drop ${pct(first.cut)}. ${day(best.date)} is the soonest it ${gently}${best.cut > 0 ? `, dropping it ${pct(best.cut)}` : ""}.`;
}

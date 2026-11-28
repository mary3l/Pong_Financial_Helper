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
//
// With a "ready by" date a plan is saved up for: set aside a share each
// payday from "save from" until the day before "ready by", so the whole
// amount is in savings by then. Paying after (in parts, or on credit from
// the ready-by date) are the other ways. Without one, Pong picks the date.

/** How far ahead Pong looks without a "by" date, and at most. */
export const WINDOW_DAYS = 365;
/** Dates checked per plan at most; a daily or weekly payday is thinned to this. */
export const MAX_DATES = 26;
/** Set-asides per plan at most: a weekly payday over a year. */
export const MAX_SET_ASIDES = 60;
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
  /** Save from: the first set-aside is on or after it (or, without "ready by", nothing is paid before it). */
  earliest: string;
  /** Ready by: the whole amount is set aside before it. Null: Pong picks the date, up to a year on. */
  by: string | null;
  /** If it goes on a card or BNPL: the fee in % a month. */
  feeRate: number;
};

export type Strategy =
  /** Set aside a share each payday from the date until the day before "ready by". */
  | { kind: "save" }
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

/**
 * Saving up: a date for each set-aside, from "save from" (or today) to the day
 * before "ready by". Each payday in between; without a payday, each month on
 * the save-from day; with none in between, one on the save-from day.
 */
export function saveUpDates(
  wish: Pick<Wish, "earliest" | "by">,
  today: string,
  payday: Schedule | null,
): string[] {
  const from = wish.earliest > today ? wish.earliest : today;
  const ready = wish.by && wish.by > from ? wish.by : addDays(from, 1);
  const dates = payday
    ? occurrences(payday, from, ready)
    : monthlyDates(from, MAX_SET_ASIDES).filter((d) => d < ready);
  return dates.length ? dates.slice(0, MAX_SET_ASIDES) : [from];
}

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

  /** Bought on each card or BNPL line on `date`, within limits and Pong's cap. */
  const onCredit = (date: string): WishPick[] =>
    CREDIT_MONTHS.flatMap((months) =>
      affordWithCredit({
        start,
        items,
        purchase: purchase(date, months),
        today,
        payday,
        lines: credit,
        cap,
        ratePerMonth: wish.feeRate,
      }).flatMap((o): WishPick[] => {
        if (!o.verdict) return [];
        const bills = o.payments.map((p) => p.dueOn);
        return [
          {
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
          },
        ];
      }),
    );

  const byOuch = (a: WishPick, b: WishPick) => gentler(a, b, wish.amount);

  if (wish.by) {
    // Saving up: a share each payday until the day before "ready by".
    const ready = wish.by;
    const dueOns = saveUpDates(wish, today, payday);
    const amounts = splitAmount(wish.amount, dueOns.length);
    const payments = dueOns.map((dueOn, i) => ({ dueOn, amount: amounts[i] }));
    const verdict = affordVerdict({
      start,
      items,
      purchase: purchase(dueOns[0], 1),
      today,
      nextPayday: null,
      payments,
    });
    const n = dueOns.length;
    const each = payday ? "payday" : "month";
    const save: WishPick = {
      date: dueOns[0],
      strategy: { kind: "save" },
      label:
        n > 1
          ? `Save ${formatPeso(amounts[0])} each ${each}, ${span(dueOns[0], dueOns.at(-1)!)} (${n} ${each}s)`
          : `Save ${formatPeso(wish.amount)} on ${day(dueOns[0])}`,
      verdict,
      payments,
      fees: 0,
      cut: cutOf(verdict),
      borrowed: false,
      setAside: null,
    };
    // Paying after: in parts from your wallets, or on credit, from the ready-by date.
    const after = [
      ...INSTALLMENT_MONTHS.map((months) => fromWallets(ready, months)),
      ...onCredit(ready),
    ]
      .filter((p) => p.verdict.tone !== "no")
      .sort(byOuch);
    const best = save.verdict.tone !== "no" ? save : (after[0] ?? null);
    return {
      best,
      others: othersThan(best, after),
      why: saveWhy(save, best, { from: dueOns[0], last: ready }, today),
      window: { from: wish.earliest > today ? wish.earliest : today, last: ready },
    };
  }

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
    spread.push(...onCredit(date));
  }

  const ranked = [...full, ...spread].filter((p) => p.verdict.tone !== "no").sort(byOuch);
  const best = ranked[0] ?? null;
  return {
    best,
    others: othersThan(best, ranked),
    why: whyText(best, full, window, today),
    window,
  };
}

/** The next best ways after `best` in `ranked`, each a different way to pay, at most 2. */
function othersThan(best: WishPick | null, ranked: WishPick[]): WishPick[] {
  const others: WishPick[] = [];
  const seen = new Set(best ? [strategyKey(best.strategy)] : []);
  for (const p of ranked) {
    if (others.length === 2) break;
    const key = strategyKey(p.strategy);
    if (seen.has(key)) continue;
    seen.add(key);
    others.push(p);
  }
  return others;
}

function saveWhy(
  save: WishPick,
  best: WishPick | null,
  window: { from: string; last: string },
  today: string,
): string {
  const day = (d: string) => formatShortDay(d, today);
  if (!best) {
    return `Saving it by ${day(window.last)} leaves your wallets short, and so does paying after. Try a later "ready by" date, or a smaller amount.`;
  }
  if (best !== save) {
    return `Saving it all by ${day(window.last)} leaves your wallets short, so paying after is the gentlest way.`;
  }
  const cut = save.verdict.biggestCut;
  return cut
    ? `Setting it aside from ${day(window.from)} drops your daily amount ${pct(save.cut)} at most, from ${day(cut.from)}. It's all saved by ${day(window.last)}.`
    : `Setting it aside from ${day(window.from)} doesn't change your daily amount. It's all saved by ${day(window.last)}.`;
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
      ? pct(best.cut) === pct(fullBest.cut)
        ? `It cuts your daily amount about the same as paying it all at once (${pct(best.cut)}).`
        : `This cuts your daily amount by ${pct(best.cut)}, against ${pct(fullBest.cut)} paying it all at once.`
      : `Paying it all at once doesn't fit by ${day(window.last)}, so spreading it out on credit does.`;
  }
  if (best.strategy.kind === "installments") {
    return fullBest
      ? pct(best.cut) === pct(fullBest.cut)
        ? `Spread over ${best.strategy.months} months it cuts your daily amount about the same as all at once (${pct(best.cut)}).`
        : `Spread over ${best.strategy.months} months it cuts your daily amount by ${pct(best.cut)}, against ${pct(fullBest.cut)} all at once.`
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

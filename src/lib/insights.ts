import { ADJUSTMENT, cleanSubcategory } from "@/lib/categories";
import {
  addDays,
  dateInMonth,
  daysBetween,
  monthContaining,
  weekdayOf,
  type Period,
} from "@/lib/dates";
import { roundCents, type TransactionType } from "@/lib/money";
import { categoryTrends, type CategoryTrend, type Span } from "@/lib/trend";

// The thinking behind Insights: what you spent compared with your usual, the
// habits behind it, and what you could change. Plain rules over your own
// transactions, so every line can be checked against Activity.

export type SpendTxn = {
  type: TransactionType;
  amount: number;
  category: string | null;
  subcategory: string | null;
  occurredOn: string;
};

/** Day-to-day spending: expenses, not transfers or balance adjustments. */
export function isSpending(t: SpendTxn): boolean {
  return t.type === "expense" && Boolean(t.category) && t.category !== ADJUSTMENT;
}

const sum = (values: number[]) => roundCents(values.reduce((a, b) => a + b, 0));

/** Rounds up to a tidy amount: ₱50 steps, or ₱10 under ₱200. */
export function tidy(amount: number): number {
  const step = amount < 200 ? 10 : 50;
  return Math.ceil(amount / step) * step;
}

/** How much of the period is done by `today` (counting today): 1 once it's over. */
export function elapsedShare(period: Period, today: string): number {
  if (today > period.end) return 1;
  if (today < period.start) return 0;
  return (daysBetween(period.start, today) + 1) / (daysBetween(period.start, period.end) + 1);
}

/**
 * Your usual for a period: the average of the periods before the last one,
 * counted from the first one you spent anything in (so the months before you
 * started logging don't pull it down). Null with fewer than 2 to go on.
 */
export function usualOf(totals: number[]): number | null {
  const before = totals.slice(0, -1);
  const first = before.findIndex((t) => t > 0);
  if (first < 0) return null;
  const used = before.slice(first);
  if (used.length < 2) return null;
  return roundCents(sum(used) / used.length);
}

// ── Summary: this period against your usual ─────────────────────────────

export type Driver = {
  key: string;
  /** The subcategory behind most of it, when one is. */
  sub: string | null;
  /** Above 0: more than usual by this point in the period. */
  diff: number;
};

export type Summary = {
  spent: number;
  /** Your usual by this point in the period (all of it once the period is over). */
  usual: number | null;
  diff: number | null;
  /** What pushed spending up, biggest first (up to 2), and the biggest drop. */
  ups: Driver[];
  down: Driver | null;
  /** Categories spending well over their usual: worth a look. */
  unusual: string[];
  /** Your biggest categories this period and their share of spending (0–1). */
  top: { keys: string[]; share: number };
};

/** Only past this much of a period are "unusual" flags fair: early on, one buy looks like a spike. */
const FLAG_FROM = 0.3;

/**
 * `trends` are categoryTrends over periods ending with the one you're
 * looking at; `share` is how much of it has gone by (elapsedShare).
 */
export function summarize(trends: CategoryTrend[], share: number): Summary {
  const spent = sum(trends.map((t) => t.current));
  const usualTotal = usualOf(
    trends[0]?.totals.map((_, i) => sum(trends.map((t) => t.totals[i]))) ?? [],
  );
  const usual = usualTotal === null ? null : roundCents(usualTotal * share);

  const drivers: Driver[] = [];
  const unusual: string[] = [];
  for (const t of trends) {
    const u = usualOf(t.totals) ?? 0;
    const diff = roundCents(t.current - u * share);
    // The subcategory behind at least half of it, if one is.
    let sub: string | null = null;
    let best = 0;
    for (const s of t.subs) {
      if (!s.name) continue;
      const subDiff = s.current - (usualOf(s.totals) ?? 0) * share;
      const size = Math.abs(subDiff);
      if (Math.sign(subDiff) === Math.sign(diff) && size >= Math.abs(diff) / 2 && size > best) {
        sub = s.name;
        best = size;
      }
    }
    drivers.push({ key: t.key, sub, diff });
    if (share >= FLAG_FROM && u > 0 && t.current >= u * share * 1.5 && diff >= 300)
      unusual.push(t.key);
  }
  const ups = drivers
    .filter((d) => d.diff >= 100)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 2);
  const down = drivers.filter((d) => d.diff <= -100).sort((a, b) => a.diff - b.diff)[0] ?? null;

  const biggest = [...trends].sort((a, b) => b.current - a.current).filter((t) => t.current > 0);
  const top = biggest.slice(0, 3);
  return {
    spent,
    usual,
    diff: usual === null ? null : roundCents(spent - usual),
    ups,
    down,
    unusual,
    top: {
      keys: top.map((t) => t.key),
      share: spent > 0 ? sum(top.map((t) => t.current)) / spent : 0,
    },
  };
}

// ── Habits ──────────────────────────────────────────────────────────────

/** Payday and the 2 days after it. */
export const PAYDAY_DAYS = 3;

export type PaydayEffect = {
  /** Share of your spending in the days right after payday (0–1)… */
  spendShare: number;
  /** …and the share of days those are. */
  dayShare: number;
  paydays: number;
};

/** How much of what you spent over [from, until] went in the days right after a payday. */
export function paydayEffect(
  txns: SpendTxn[],
  paydays: string[],
  from: string,
  until: string,
): PaydayEffect | null {
  const days = new Set<string>();
  for (const p of paydays)
    for (let i = 0; i < PAYDAY_DAYS; i++) {
      const d = addDays(p, i);
      if (d >= from && d <= until) days.add(d);
    }
  const spending = txns.filter(
    (t) => isSpending(t) && t.occurredOn >= from && t.occurredOn <= until,
  );
  const total = sum(spending.map((t) => t.amount));
  const totalDays = daysBetween(from, until) + 1;
  if (paydays.length < 2 || total <= 0 || days.size === 0 || days.size >= totalDays) return null;
  return {
    spendShare: sum(spending.filter((t) => days.has(t.occurredOn)).map((t) => t.amount)) / total,
    dayShare: days.size / totalDays,
    paydays: paydays.length,
  };
}

export type WeekendSplit = { weekendPerDay: number; weekdayPerDay: number };

/** What you spend on an average Saturday or Sunday against an average weekday, over [from, until]. */
export function weekendSplit(txns: SpendTxn[], from: string, until: string): WeekendSplit | null {
  let weekendDays = 0;
  let weekdays = 0;
  for (let d = from; d <= until; d = addDays(d, 1)) {
    if (weekdayOf(d) % 6 === 0) weekendDays++;
    else weekdays++;
  }
  if (!weekendDays || !weekdays) return null;
  let weekend = 0;
  let weekday = 0;
  for (const t of txns) {
    if (!isSpending(t) || t.occurredOn < from || t.occurredOn > until) continue;
    if (weekdayOf(t.occurredOn) % 6 === 0) weekend += t.amount;
    else weekday += t.amount;
  }
  if (weekend + weekday <= 0) return null;
  return {
    weekendPerDay: roundCents(weekend / weekendDays),
    weekdayPerDay: roundCents(weekday / weekdays),
  };
}

export type Frequent = {
  key: string;
  /** The subcategory; null when it's the category's buys without one. */
  sub: string | null;
  count: number;
  average: number;
  total: number;
};

/** Small buys that happen often: at least this many in the window… */
export const FREQUENT_COUNT = 6;
/** …each at most this much on average. */
export const SMALL_BUY = 300;

/** Small buys you make often over [from, until], adding up the most first (up to 3). */
export function frequentBuys(txns: SpendTxn[], from: string, until: string): Frequent[] {
  const groups = new Map<string, { key: string; sub: string | null; amounts: number[] }>();
  // Newest first, so a subcategory is spelled the newest way.
  for (const t of txns) {
    if (!isSpending(t) || t.occurredOn < from || t.occurredOn > until) continue;
    const sub = cleanSubcategory(t.subcategory);
    const id = `${t.category}\u0000${sub?.toLowerCase() ?? ""}`;
    const group = groups.get(id) ?? { key: t.category!, sub, amounts: [] };
    group.amounts.push(t.amount);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((g) => {
      const total = sum(g.amounts);
      return {
        key: g.key,
        sub: g.sub,
        count: g.amounts.length,
        average: roundCents(total / g.amounts.length),
        total,
      };
    })
    .filter((f) => f.count >= FREQUENT_COUNT && f.average <= SMALL_BUY)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
}

// ── What you can adjust ─────────────────────────────────────────────────

/** Weeks in an average month. */
const WEEKS_PER_MONTH = 30.44 / 7;

export type GoalDraft = { category: string; sub: string | null; limit: number };

export type Suggestion =
  | {
      kind: "fewer";
      key: string;
      sub: string | null;
      /** Times a week now, and the saving from 2 fewer a week, per month. */
      perWeek: number;
      saves: number;
      goal: GoalDraft;
    }
  | {
      kind: "usual";
      key: string;
      sub: string | null;
      /** Over your usual by this much; your usual for the whole period. */
      over: number;
      usual: number;
      goal: GoalDraft;
    }
  | { kind: "budget"; key: string; usual: number; amount: number };

/**
 * Up to 4 things you could change, the biggest saving first: cut back on a
 * small buy you make often, bring a category that's over its usual back to
 * it, and a budget for a big category that has none.
 *
 * `frequent` covers `windowDays` days; budgets are per kinsenas, so
 * `kinsenasUsual` is each category's usual per kinsenas.
 */
export function suggestions({
  trends,
  summary,
  frequent,
  windowDays,
  budgeted,
  kinsenasUsual,
}: {
  trends: CategoryTrend[];
  summary: Summary;
  frequent: Frequent[];
  windowDays: number;
  budgeted: Set<string>;
  kinsenasUsual: Map<string, number>;
}): Suggestion[] {
  const out: (Suggestion & { worth: number })[] = [];

  for (const f of frequent) {
    const perWeek = (f.count / windowDays) * 7;
    if (perWeek < 3) continue;
    const saves = roundCents(f.average * 2 * WEEKS_PER_MONTH);
    const perMonth = (f.total / windowDays) * 30.44;
    out.push({
      kind: "fewer",
      key: f.key,
      sub: f.sub,
      perWeek: Math.round(perWeek * 10) / 10,
      saves: tidy(saves),
      goal: { category: f.key, sub: f.sub, limit: tidy(Math.max(0, perMonth - saves)) },
      worth: saves,
    });
  }

  for (const d of summary.ups) {
    const trend = trends.find((t) => t.key === d.key);
    const sub = d.sub ? trend?.subs.find((s) => s.name === d.sub) : null;
    const usual = usualOf((sub ?? trend)?.totals ?? []);
    if (!usual || d.diff < 300) continue;
    // Already covered by a "fewer" for the same thing.
    if (out.some((s) => s.kind === "fewer" && s.key === d.key && (!d.sub || s.sub === d.sub)))
      continue;
    out.push({
      kind: "usual",
      key: d.key,
      sub: d.sub,
      over: tidy(d.diff),
      usual: tidy(usual),
      goal: { category: d.key, sub: d.sub, limit: tidy(usual) },
      worth: d.diff,
    });
  }

  const unbudgeted = [...kinsenasUsual]
    .filter(([key, usual]) => !budgeted.has(key) && usual >= 500)
    .sort((a, b) => b[1] - a[1])[0];
  if (unbudgeted) {
    const [key, usual] = unbudgeted;
    // Ranked last: it's a habit to build, not money saved straight away.
    out.push({ kind: "budget", key, usual: roundCents(usual), amount: tidy(usual), worth: 0 });
  }

  return out
    .sort((a, b) => b.worth - a.worth)
    .slice(0, 4)
    .map((s) => {
      const { worth, ...suggestion } = s;
      void worth;
      return suggestion as Suggestion;
    });
}

export type BudgetPace = {
  key: string;
  limit: number;
  spent: number;
  /** Where you'd be spending evenly: the limit times how much of the period is done. */
  expected: number;
  status: "over" | "ahead" | "on_pace";
};

/** Each budget against this period's spending. Budgets are per kinsenas, so a month doubles them. */
export function budgetPace(
  budgets: { category: string; amount: number }[],
  trends: CategoryTrend[],
  span: Span,
  share: number,
): BudgetPace[] {
  return budgets
    .map((b) => {
      const limit = roundCents(b.amount * (span === "month" ? 2 : 1));
      const spent = trends.find((t) => t.key === b.category)?.current ?? 0;
      const expected = roundCents(limit * share);
      const status: BudgetPace["status"] =
        spent > limit ? "over" : spent > expected * 1.1 && share < 1 ? "ahead" : "on_pace";
      return { key: b.category, limit, spent, expected, status };
    })
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit);
}

// ── SMART goals ─────────────────────────────────────────────────────────

export type Goal = {
  id: string;
  category: string;
  subcategory: string | null;
  limit: number;
  startsOn: string;
  endsOn: string;
};

export type GoalProgress = {
  spent: number;
  /** Over: spent past the limit. At risk: ahead of an even pace. */
  status: "on_track" | "at_risk" | "over" | "met" | "missed";
  /** Days left, today included; 0 once it's over. */
  daysLeft: number;
  /** What's left to spend a day and still make it. */
  perDayLeft: number;
};

/** Does this buy count toward the goal: its category, and its subcategory if the goal has one. */
export function countsToward(goal: Goal, t: SpendTxn): boolean {
  if (!isSpending(t) || t.category !== goal.category) return false;
  if (t.occurredOn < goal.startsOn || t.occurredOn > goal.endsOn) return false;
  if (!goal.subcategory) return true;
  return cleanSubcategory(t.subcategory)?.toLowerCase() === goal.subcategory.toLowerCase();
}

export function goalProgress(goal: Goal, txns: SpendTxn[], today: string): GoalProgress {
  const spent = sum(txns.filter((t) => countsToward(goal, t)).map((t) => t.amount));
  if (today > goal.endsOn) {
    return { spent, status: spent <= goal.limit ? "met" : "missed", daysLeft: 0, perDayLeft: 0 };
  }
  const daysLeft = daysBetween(today < goal.startsOn ? goal.startsOn : today, goal.endsOn) + 1;
  const share = elapsedShare({ start: goal.startsOn, end: goal.endsOn }, today);
  const status: GoalProgress["status"] =
    spent > goal.limit ? "over" : spent > goal.limit * share * 1.1 ? "at_risk" : "on_track";
  return {
    spent,
    status,
    daysLeft,
    perDayLeft: roundCents(Math.max(0, goal.limit - spent) / daysLeft),
  };
}

// ── Where it went ───────────────────────────────────────────────────────

/** How many categories get their own slice and place in the top list; the rest are Other. */
export const TOP_COUNT = 3;

export type MonthSlice = {
  /** A category key, or "other" for everything past the top ones. */
  key: string;
  amount: number;
  /** Whole percent of the month's spending; the slices add up to 100. */
  share: number;
};

export type MonthBreakdown = {
  /** This month, up to today while it's running. */
  month: Period;
  /** Last month, cut to the same number of days while this one is running. */
  last: Period;
  running: boolean;
  total: number;
  lastTotal: number;
  /** total − lastTotal: above 0 is spending more. */
  change: number;
  /** The biggest categories, biggest first, each against last month. */
  top: CategoryTrend[];
  slices: MonthSlice[];
};

/**
 * Where the calendar month holding `anchor` went: its biggest categories and
 * an Other slice, against last month. While the month is running, last month
 * is cut to the same day (Mar 31 compares with Feb 28), so it's fair. Null
 * when nothing was spent. Expenses only, like categoryTrends.
 */
export function monthBreakdown(
  txns: SpendTxn[],
  anchor: string,
  today: string,
): MonthBreakdown | null {
  const full = monthContaining(anchor);
  const running = full.start <= today && today <= full.end;
  const month = { start: full.start, end: running ? today : full.end };
  const lastFull = monthContaining(addDays(full.start, -1));
  const [y, m] = lastFull.start.split("-").map(Number);
  const last = {
    start: lastFull.start,
    end: running ? dateInMonth(y, m, Number(today.slice(8))) : lastFull.end,
  };

  const trends = categoryTrends(txns, [last, month]);
  const total = roundCents(trends.reduce((sum, t) => sum + t.current, 0));
  if (total <= 0) return null;
  const lastTotal = roundCents(trends.reduce((sum, t) => sum + t.previous, 0));

  const spent = trends.filter((t) => t.current > 0).sort((a, b) => b.current - a.current);
  const top = spent.slice(0, TOP_COUNT);
  const rest = roundCents(spent.slice(TOP_COUNT).reduce((sum, t) => sum + t.current, 0));
  const slices: MonthSlice[] = top.map((t) => ({
    key: t.key,
    amount: t.current,
    share: Math.round((t.current / total) * 100),
  }));
  const counted = slices.reduce((sum, s) => sum + s.share, 0);
  // Other takes what's left of 100; anything rounding still leaves goes to the biggest.
  if (rest > 0) slices.push({ key: "other", amount: rest, share: Math.max(0, 100 - counted) });
  slices[0].share += 100 - slices.reduce((sum, s) => sum + s.share, 0);

  return {
    month,
    last,
    running,
    total,
    lastTotal,
    change: roundCents(total - lastTotal),
    top,
    slices,
  };
}

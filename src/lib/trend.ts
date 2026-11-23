import { ADJUSTMENT, cleanSubcategory } from "@/lib/categories";
import {
  addDays,
  monthContaining,
  periodContaining,
  previousPeriod,
  type Period,
} from "@/lib/dates";
import { roundCents, type TransactionType } from "@/lib/money";

// Insights: is spending in each category (and subcategory) going up or down?
// Totals per kinsenas or month for the last few periods, and the change from
// the one before the period you're looking at.

/** Activity and Insights look at one kinsenas, or one month (?span=month). */
export type Span = "kinsenas" | "month";

export function readSpan(value: unknown): Span {
  return value === "month" ? "month" : "kinsenas";
}

/** The kinsenas or month `date` is in. */
export function periodOf(span: Span, date: string): Period {
  return span === "month" ? monthContaining(date) : periodContaining(date);
}

export function periodBefore(span: Span, period: Period): Period {
  return span === "month" ? monthContaining(addDays(period.start, -1)) : previousPeriod(period);
}

export function periodAfter(span: Span, period: Period): Period {
  return periodOf(span, addDays(period.end, 1));
}

/** The last `count` periods up to the one `anchor` is in, oldest first. */
export function trendPeriods(span: Span, anchor: string, count = 6): Period[] {
  const periods = [periodOf(span, anchor)];
  while (periods.length < count) periods.unshift(periodBefore(span, periods[0]));
  return periods;
}

export type Trend = {
  /** Spent in each period, oldest first; the last is the one you're looking at. */
  totals: number[];
  current: number;
  previous: number;
  /** current − previous: above 0 is spending more. */
  change: number;
  /** The change as a share of the previous period; null when that was ₱0. */
  percent: number | null;
};

export type SubcategoryTrend = Trend & {
  /** As spelled most recently; null for spending with no subcategory. */
  name: string | null;
};

export type CategoryTrend = Trend & { key: string; subs: SubcategoryTrend[] };

type Txn = {
  type: TransactionType;
  amount: number;
  category: string | null;
  subcategory: string | null;
  occurredOn: string;
};

function trendOf(totals: number[]): Trend {
  const rounded = totals.map(roundCents);
  const current = rounded.at(-1) ?? 0;
  const previous = rounded.at(-2) ?? 0;
  const change = roundCents(current - previous);
  return {
    totals: rounded,
    current,
    previous,
    change,
    percent: previous > 0 ? Math.round((change / previous) * 100) : null,
  };
}

/** Growing first (biggest increase on top), then the rest; nothing spent now goes last. */
function byChange(a: Trend, b: Trend): number {
  return Number(a.current === 0) - Number(b.current === 0) || b.change - a.change;
}

/**
 * Every expense category spent in `periods`, with each of its subcategories.
 * `txns` are newest first (as getTransactions returns them), so a subcategory
 * typed as "jeep" and "Jeep" is one, spelled the newest way. Income,
 * transfers and balance adjustments aren't spending, so they're left out.
 */
export function categoryTrends(txns: Txn[], periods: Period[]): CategoryTrend[] {
  const slot = (date: string) => periods.findIndex((p) => p.start <= date && date <= p.end);
  const categories = new Map<
    string,
    { totals: number[]; subs: Map<string, { name: string | null; totals: number[] }> }
  >();
  for (const t of txns) {
    if (t.type !== "expense" || !t.category || t.category === ADJUSTMENT) continue;
    const i = slot(t.occurredOn);
    if (i < 0) continue;
    let category = categories.get(t.category);
    if (!category) {
      category = { totals: periods.map(() => 0), subs: new Map() };
      categories.set(t.category, category);
    }
    category.totals[i] += t.amount;
    const name = cleanSubcategory(t.subcategory);
    const subKey = name?.toLowerCase() ?? "";
    let sub = category.subs.get(subKey);
    if (!sub) {
      sub = { name, totals: periods.map(() => 0) };
      category.subs.set(subKey, sub);
    }
    sub.totals[i] += t.amount;
  }
  return [...categories]
    .map(([key, c]) => ({
      key,
      ...trendOf(c.totals),
      subs: [...c.subs.values()]
        .map((s) => ({ name: s.name, ...trendOf(s.totals) }))
        .sort(byChange),
    }))
    .sort(byChange);
}

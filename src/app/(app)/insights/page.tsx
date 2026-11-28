import { connection } from "next/server";
import { Suspense } from "react";
import { PeriodNav } from "@/components/period-nav";
import { Pong } from "@/components/pong";
import {
  categoriesFor,
  categoryLabel,
  subcategoriesWithStarters,
  subcategoryOptions,
} from "@/lib/categories";
import {
  getAccounts,
  getBudgets,
  getGoals,
  getRecurringItems,
  getTransactions,
  getUserCategories,
  withoutArchived,
} from "@/lib/data";
import {
  addDays,
  formatMonth,
  formatPeriod,
  isValidDate,
  monthContaining,
  periodContaining,
  today as getToday,
  type Period,
} from "@/lib/dates";
import {
  budgetPace,
  elapsedShare,
  frequentBuys,
  goalProgress,
  monthBreakdown,
  paydayEffect,
  suggestions,
  summarize,
  usualOf,
  weekendSplit,
  type Suggestion,
} from "@/lib/insights";
import { inPesos } from "@/lib/money";
import { occurrences } from "@/lib/schedule";
import { categoryTrends, periodOf, readSpan, trendPeriods, type Span } from "@/lib/trend";
import { GoalComposer, type GoalPrefill } from "./goal-controls";
import { WhereItWent } from "./where-it-went";
import {
  AdjustSection,
  BudgetSection,
  CategorySection,
  GoalsSection,
  HabitsSection,
  SummaryCard,
  type Labeler,
} from "./sections";

export const metadata = { title: "Insights · Pong Money" };

const PERIODS = 6;
/** Small buys that add up are counted over the last 30 days. */
const FREQUENT_DAYS = 30;

// Your spending habits: this period against your usual, your SMART goals,
// what you could change, budgets on pace and habits (payday, weekends, small
// buys) down the left; each category and subcategory over the last 6
// kinsenas (or months, ?span=month) up to the one you're looking at (?p=) on
// the right from lg up, under the rest on a phone.
// Goals, suggestions and budgets are about now, so they show on the current
// period only. The work is in lib/insights.ts and lib/trend.ts.
export default function InsightsPage({ searchParams }: PageProps<"/insights">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-6xl">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Insights</h1>
        <p className="text-[15px] text-muted">
          How you spend, how it compares with your usual, and what you could change.
        </p>
      </div>
      <Suspense fallback={<InsightsSkeleton />}>
        <Insights searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Insights({ searchParams }: Pick<PageProps<"/insights">, "searchParams">) {
  const params = await searchParams;
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const span = readSpan(params.span);
  const p =
    typeof params.p === "string" && isValidDate(params.p) && params.p <= today ? params.p : today;
  const periods = trendPeriods(span, p, PERIODS);
  const period = periods.at(-1)!;
  const isCurrent = period.start === periodOf(span, today).start;
  const unit = span === "month" ? "month" : "kinsenas";

  // Where it went is always the whole calendar month (up to today), so a
  // kinsenas reads on to its month's end. Every other section keeps to its own dates.
  const monthEnd = monthContaining(period.start).end;
  const to = [period.end, monthEnd < today ? monthEnd : today].sort().at(-1)!;
  const [accounts, raw, custom, budgets, recurring, savedGoals] = await Promise.all([
    getAccounts({ includeArchived: true, includePeople: true }),
    getTransactions({ from: periods[0].start, to }).then(withoutArchived),
    getUserCategories(),
    getBudgets(),
    getRecurringItems(),
    getGoals(),
  ]);
  // Spending from a dollar wallet counts in pesos.
  const txns = inPesos(raw, accounts);
  const trends = categoryTrends(txns, periods);
  const share = elapsedShare(period, today);
  const summary = summarize(trends, share);
  const unusual = new Set(summary.unusual);
  const label: Labeler = (key, sub) => categoryLabel("expense", key, sub, custom);
  const breakdown = monthBreakdown(txns, period.start, today);

  // Habits: over all the periods shown, up to today.
  const from = periods[0].start;
  const until = today < period.end ? today : period.end;
  const payday = recurring.find((r) => r.kind === "payday");
  // Paid every day, there's no "right after payday".
  const paydays =
    payday && payday.frequency !== "daily" ? occurrences(payday, from, addDays(until, 1)) : [];
  const frequent = frequentBuys(txns, addDays(until, -(FREQUENT_DAYS - 1)), until);

  // Budgets are per kinsenas, so the usual they're set from is too.
  const kinsenasUsual = new Map<string, number>();
  for (const t of trends) {
    const u = usualOf(t.totals);
    if (u !== null) kinsenasUsual.set(t.key, span === "month" ? u / 2 : u);
  }
  const advice = suggestions({
    trends,
    summary,
    frequent,
    windowDays: FREQUENT_DAYS,
    budgeted: new Set(budgets.map((b) => b.category)),
    kinsenasUsual,
  });

  // Goals: running ones, and ones that ended in the last 30 days.
  const goals =
    savedGoals === "missing" ? [] : savedGoals.filter((g) => g.endsOn >= addDays(today, -30));
  const earliest = goals.reduce((min, g) => (g.startsOn < min ? g.startsOn : min), from);
  const goalTxns =
    goals.length && (earliest < from || until < today)
      ? inPesos(
          await getTransactions({ from: earliest, to: today }).then(withoutArchived),
          accounts,
        )
      : txns;
  const progress = goals
    .map((goal) => ({ goal, progress: goalProgress(goal, goalTxns, today) }))
    // Running ones first, the soonest to end on top.
    .sort((a, b) => Number(a.progress.daysLeft === 0) - Number(b.progress.daysLeft === 0));

  const ends = { kinsenas: periodContaining(today).end, month: monthContaining(today).end };
  const goalHref = (s: Extract<Suggestion, { goal: unknown }>) => {
    // Fewer of a buy: the next 30 days. Back to usual: the next kinsenas or month.
    const days = s.kind === "fewer" || span === "month" ? 30 : 15;
    const query = new URLSearchParams({
      goal: "1",
      gc: s.goal.category,
      gl: String(s.goal.limit),
      ge: addDays(today, days - 1),
    });
    if (s.goal.sub) query.set("gs", s.goal.sub);
    return `/insights?${query}#goals`;
  };
  const prefill = readPrefill(params, today);
  // The goal form's suggestions: yours first, then each category's starters,
  // so a goal can be on "Food › Coffee & milk tea" before you've logged one.
  const used = subcategoryOptions(raw);
  const goalSubcategories = Object.fromEntries(
    categoriesFor("expense", custom).map((c) => [
      c.key,
      subcategoriesWithStarters(c.key, used[c.key]).map((s) => s.name),
    ]),
  );

  const name = (x: Period) =>
    span === "month" ? formatMonth(x.start).split(" ")[0] : formatPeriod(x, today);
  const vs = name(periods.at(-2)!);
  const href = (start: string, s: Span) =>
    `/insights?${new URLSearchParams({ p: start, ...(s === "month" ? { span: s } : {}) })}`;
  const activity = (c: string, sub?: string | null) => {
    const query = new URLSearchParams({ p: period.start, c });
    if (span === "month") query.set("span", span);
    if (sub) query.set("sub", sub);
    return `/activity?${query}`;
  };

  if (!trends.length && !goals.length) {
    return (
      <>
        <PeriodNav span={span} period={period} today={today} href={href} />
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
          <Pong mood="sleepy" size={100} decorative />
          <p className="max-w-xs text-[15px] text-muted">
            Nothing spent in the last {PERIODS} {span === "month" ? "months" : "kinsenas"} yet. Log
            a few weeks of spending and I&apos;ll show you your habits.
          </p>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-5">
        <PeriodNav span={span} period={period} today={today} href={href} />

        {breakdown && (
          <WhereItWent
            data={breakdown}
            custom={custom}
            today={today}
            activityHref={(c) =>
              `/activity?${new URLSearchParams({ p: breakdown.month.start, span: "month", c })}`
            }
          />
        )}

        <SummaryCard summary={summary} label={label} unit={unit} isCurrent={isCurrent} />

        {isCurrent && (
          <GoalsSection
            goals={progress}
            label={label}
            today={today}
            missing={savedGoals === "missing"}
          >
            <GoalComposer
              // A new Make it a goal opens it afresh, filled in.
              key={prefill ? JSON.stringify(prefill) : "new"}
              hasGoals={progress.length > 0}
              categories={categoriesFor("expense", custom).map((c) => ({
                key: c.key,
                label: c.label,
              }))}
              subcategories={goalSubcategories}
              usual={Object.fromEntries(kinsenasUsual)}
              ends={ends}
              today={today}
              prefill={prefill}
            />
          </GoalsSection>
        )}

        {isCurrent && (
          <AdjustSection items={advice} label={label} unit={unit} goalHref={goalHref} />
        )}

        {isCurrent && budgets.length > 0 && (
          <BudgetSection items={budgetPace(budgets, trends, span, share)} label={label} />
        )}

        <HabitsSection
          payday={paydayEffect(txns, paydays, from, until)}
          weekend={weekendSplit(txns, from, until)}
          frequent={frequent}
          label={label}
          activityHref={(key, sub) => activity(key, sub)}
          windowNote={`the last ${PERIODS} ${span === "month" ? "months" : "kinsenas"}`}
        />
      </div>

      {trends.length > 0 && (
        <CategorySection
          trends={trends}
          custom={custom}
          unusual={unusual}
          isCurrent={isCurrent}
          unit={unit}
          vs={vs}
          activityHref={activity}
        />
      )}
    </div>
  );
}

/** A goal filled in from a suggestion's Make it a goal (?goal=1&gc=&gs=&gl=&ge=). */
function readPrefill(
  params: Record<string, string | string[] | undefined>,
  today: string,
): GoalPrefill | null {
  if (params.goal !== "1" || typeof params.gc !== "string") return null;
  const limit = Number(params.gl);
  const endsOn =
    typeof params.ge === "string" && isValidDate(params.ge) && params.ge >= today
      ? params.ge
      : null;
  if (!(limit > 0) || !endsOn) return null;
  return {
    category: params.gc.slice(0, 40),
    sub: typeof params.gs === "string" ? params.gs.slice(0, 40) : "",
    limit,
    endsOn,
  };
}

function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="h-12 rounded-[16px] bg-line-soft" />
      <div className="h-16 rounded-[20px] bg-line-soft" />
      <div className="h-20 rounded-[20px] bg-line-soft" />
      <div className="h-20 rounded-[20px] bg-line-soft" />
      <div className="h-20 rounded-[20px] bg-line-soft" />
    </div>
  );
}

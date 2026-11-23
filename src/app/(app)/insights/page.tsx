import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronIcon, PathIcon } from "@/components/icons";
import { PeriodNav } from "@/components/period-nav";
import { Pong } from "@/components/pong";
import { categoriesFor, categoryInfo, categoryLabel, subcategoryOptions } from "@/lib/categories";
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
  paydayEffect,
  suggestions,
  summarize,
  usualOf,
  weekendSplit,
  type Suggestion,
} from "@/lib/insights";
import { formatPeso, inPesos } from "@/lib/money";
import { occurrences } from "@/lib/schedule";
import {
  categoryTrends,
  periodOf,
  readSpan,
  trendPeriods,
  type Span,
  type Trend,
} from "@/lib/trend";
import { GoalForm, type GoalPrefill } from "./goal-controls";
import {
  AdjustSection,
  BudgetSection,
  GoalsSection,
  HabitsSection,
  SummaryCard,
  type Labeler,
} from "./sections";
import { TrendBars } from "./trend-bars";

export const metadata = { title: "Insights · Pong Money" };

const PERIODS = 6;
/** Small buys that add up are counted over the last 30 days. */
const FREQUENT_DAYS = 30;

// Your spending habits, top to bottom: this period against your usual, your
// SMART goals, what you could change, budgets on pace, habits (payday,
// weekends, small buys), then each category and subcategory over the last 6
// kinsenas (or months, ?span=month) up to the one you're looking at (?p=).
// Goals, suggestions and budgets are about now, so they show on the current
// period only. The work is in lib/insights.ts and lib/trend.ts.
export default function InsightsPage({ searchParams }: PageProps<"/insights">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
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

  const [accounts, raw, custom, budgets, recurring, savedGoals] = await Promise.all([
    getAccounts({ includeArchived: true, includePeople: true }),
    getTransactions({ from: periods[0].start, to: period.end }).then(withoutArchived),
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

  const name = (x: Period) =>
    span === "month" ? formatMonth(x.start).split(" ")[0] : formatPeriod(x, today);
  const labels = periods.map(name);
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
    <>
      <PeriodNav span={span} period={period} today={today} href={href} />

      <SummaryCard summary={summary} label={label} unit={unit} isCurrent={isCurrent} />

      {isCurrent && (
        <GoalsSection
          goals={progress}
          label={label}
          today={today}
          missing={savedGoals === "missing"}
        >
          <details open={Boolean(prefill)} className="group rounded-[20px] bg-card px-4 py-1">
            <summary className="flex h-12 cursor-pointer list-none items-center gap-2 font-extrabold text-sea-dark [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">+</span>
              {progress.length ? "New goal" : "Set your first goal"}
            </summary>
            <GoalForm
              categories={categoriesFor("expense", custom).map((c) => ({
                key: c.key,
                label: c.label,
              }))}
              subcategories={subcategoryOptions(raw)}
              usual={Object.fromEntries(kinsenasUsual)}
              ends={ends}
              today={today}
              prefill={prefill}
            />
          </details>
        </GoalsSection>
      )}

      {isCurrent && <AdjustSection items={advice} label={label} unit={unit} goalHref={goalHref} />}

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

      {trends.length > 0 && (
        <section aria-labelledby="categories-heading" className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h2 id="categories-heading" className="font-display text-xl font-semibold">
              By category
            </h2>
            <p className="text-[13px] text-muted">Growing first. Tap one for its subcategories.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {trends.map((t) => {
              const info = categoryInfo("expense", t.key, custom);
              return (
                <li key={t.key}>
                  <details className="group rounded-[20px] bg-card">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span
                        className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] ${info.tint}`}
                      >
                        <PathIcon d={info.icon} size={21} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-bold">{info.label}</span>
                            {unusual.has(t.key) && (
                              <span className="shrink-0 rounded-full bg-sun-tint px-2 py-0.5 text-[11px] font-extrabold text-sun-text">
                                Unusual
                              </span>
                            )}
                          </span>
                          <Amount trend={t} soFar={isCurrent} />
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <Change trend={t} vs={vs} unit={unit} />
                          <TrendBars totals={t.totals} labels={labels} />
                        </span>
                      </span>
                      <ChevronIcon
                        size={20}
                        className="shrink-0 text-muted transition-transform group-open:rotate-90"
                      />
                    </summary>
                    <ul className="mx-4 flex flex-col border-t border-line-soft pb-1.5">
                      {t.subs.map((s) => (
                        <li key={s.name ?? ""} className="border-b border-line-soft last:border-0">
                          <Link
                            href={activity(t.key, s.name)}
                            className="flex min-h-14 flex-col justify-center gap-0.5 py-2 pl-[54px] text-ink"
                          >
                            <span className="flex items-baseline justify-between gap-2">
                              <span
                                className={`truncate text-[15px] font-bold ${s.name ? "" : "text-muted"}`}
                              >
                                {s.name ?? "No subcategory"}
                              </span>
                              <Amount trend={s} soFar={false} />
                            </span>
                            <span className="flex items-center justify-between gap-2">
                              <Change trend={s} vs={vs} unit={unit} />
                              <TrendBars totals={s.totals} labels={labels} height={22} />
                            </span>
                          </Link>
                        </li>
                      ))}
                      <li>
                        <Link
                          href={activity(t.key)}
                          className="flex h-11 items-center pl-[54px] text-[15px] font-extrabold text-sea-dark"
                        >
                          See all {info.label} in Activity
                        </Link>
                      </li>
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
          <p className="text-[13px] text-muted">
            Each bar is what you spent in one {unit}; the last is{" "}
            {isCurrent ? `this ${unit} so far` : "the one shown"}. Bars are scaled to each row, so
            compare categories by their amounts. Transfers and balance adjustments aren&apos;t
            counted.
          </p>
        </section>
      )}
    </>
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

function Amount({ trend, soFar }: { trend: Trend; soFar: boolean }) {
  return (
    <span className="shrink-0 font-display text-[17px] font-semibold">
      {formatPeso(trend.current)}
      {soFar && <span className="ml-1 font-sans text-xs font-bold text-muted">so far</span>}
    </span>
  );
}

/** "↑ ₱420 (+18%) vs Nov 1 – 15", in amber when it's more and green when it's less. */
function Change({ trend, vs, unit }: { trend: Trend; vs: string; unit: string }) {
  const { change, percent, current } = trend;
  if (change === 0) {
    return (
      <span className="text-[13px] text-muted">
        {current === 0 ? `None this ${unit}` : `No change vs ${vs}`}
      </span>
    );
  }
  if (percent === null) {
    return <span className="text-[13px] font-bold text-sun-text">New · ₱0 last {unit}</span>;
  }
  const up = change > 0;
  return (
    <span className={`text-[13px] font-bold ${up ? "text-sun-text" : "text-sea-dark"}`}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      <span className="sr-only">{up ? "Up" : "Down"}</span> {formatPeso(Math.abs(change))} (
      {up ? "+" : "−"}
      {Math.abs(percent)}%) <span className="font-normal text-muted">vs {vs}</span>
    </span>
  );
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

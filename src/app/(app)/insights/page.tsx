import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronIcon, PathIcon } from "@/components/icons";
import { PeriodNav } from "@/components/period-nav";
import { Pong } from "@/components/pong";
import { categoryInfo } from "@/lib/categories";
import { getAccounts, getTransactions, getUserCategories, withoutArchived } from "@/lib/data";
import {
  formatMonth,
  formatPeriod,
  isValidDate,
  today as getToday,
  type Period,
} from "@/lib/dates";
import { formatPeso, inPesos } from "@/lib/money";
import {
  categoryTrends,
  periodOf,
  readSpan,
  trendPeriods,
  type Span,
  type Trend,
} from "@/lib/trend";
import { TrendBars } from "./trend-bars";

export const metadata = { title: "Insights · Pong Money" };

const PERIODS = 6;

// Is spending in each category, and each subcategory, going up or down? The
// last 6 kinsenas (or months, ?span=month) up to the one you're looking at
// (?p=), growing categories first. Each row opens Activity filtered to it.
export default function InsightsPage({ searchParams }: PageProps<"/insights">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Insights</h1>
        <p className="text-[15px] text-muted">Is your spending going up or down?</p>
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

  const [accounts, txns, custom] = await Promise.all([
    getAccounts({ includeArchived: true, includePeople: true }),
    getTransactions({ from: periods[0].start, to: period.end }).then(withoutArchived),
    getUserCategories(),
  ]);
  // Spending from a dollar wallet counts in pesos.
  const trends = categoryTrends(inPesos(txns, accounts), periods);

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

  return (
    <>
      <PeriodNav span={span} period={period} today={today} href={href} />

      {trends.length ? (
        <>
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
                          <span className="truncate font-bold">{info.label}</span>
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
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
          <Pong mood="sleepy" size={100} decorative />
          <p className="max-w-xs text-[15px] text-muted">
            Nothing spent in the last {PERIODS} {span === "month" ? "months" : "kinsenas"} yet.
          </p>
        </div>
      )}
    </>
  );
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

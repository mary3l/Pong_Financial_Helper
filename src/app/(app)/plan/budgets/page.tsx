import { connection } from "next/server";
import { Suspense } from "react";
import { categoryInfo } from "@/lib/categories";
import { getBudgets, getTransactions, getUserCategories } from "@/lib/data";
import {
  daysBetween,
  formatPeriod,
  monthContaining,
  periodContaining,
  today as getToday,
} from "@/lib/dates";
import { formatPeso, roundCents } from "@/lib/money";
import { PlanTabs, SegmentLinks } from "../plan-tabs";
import { BudgetManager, type BudgetRow } from "./budget-manager";

export const metadata = { title: "Budgets · Pong Money" };

// Design canvas 3.3: spending limits per category, per kinsenas. "This
// month" is two kinsenas, so every limit doubles.
export default function BudgetsPage({ searchParams }: PageProps<"/plan/budgets">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Plan</h1>
      <PlanTabs current="budgets" />
      <Suspense fallback={<BudgetsSkeleton />}>
        <Budgets searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Budgets({ searchParams }: Pick<PageProps<"/plan/budgets">, "searchParams">) {
  const params = await searchParams;
  const view = params.view === "month" ? "month" : "kinsenas";
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const period = view === "month" ? monthContaining(today) : periodContaining(today);
  const times = view === "month" ? 2 : 1;

  const [budgets, transactions, custom] = await Promise.all([
    getBudgets(),
    getTransactions({ from: period.start, to: period.end }),
    getUserCategories(),
  ]);
  const spent = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense" || t.category === "adjustment") continue;
    const key = t.category ?? "other";
    spent.set(key, roundCents((spent.get(key) ?? 0) + t.amount));
  }

  const rows: BudgetRow[] = budgets.map((b) => ({
    id: b.id,
    category: b.category,
    perKinsenas: b.amount,
    limit: roundCents(b.amount * times),
    spent: spent.get(b.category) ?? 0,
  }));
  const budgeted = roundCents(rows.reduce((sum, r) => sum + r.limit, 0));
  const used = roundCents(rows.reduce((sum, r) => sum + r.spent, 0));
  const left = roundCents(budgeted - used);
  const daysToGo = daysBetween(today, period.end) + 1;
  const unbudgeted = [...spent].filter(([key]) => !budgets.some((b) => b.category === key));

  return (
    <>
      <SegmentLinks
        label="Budget period"
        options={[
          { href: "/plan/budgets", label: "This kinsenas", current: view === "kinsenas" },
          { href: "/plan/budgets?view=month", label: "This month", current: view === "month" },
        ]}
      />

      {rows.length > 0 && (
        <section className="flex flex-col gap-1.5 rounded-[28px] bg-sea p-6 text-white">
          <h2 className="text-sm font-bold text-sea-text uppercase">
            {formatPeriod(period, today)}
          </h2>
          <p className="font-display text-4xl leading-tight font-semibold">
            {left >= 0 ? `${formatPeso(left)} left` : `Over by ${formatPeso(-left)}`}
          </p>
          <p className="text-[15px] text-sea-text">
            of {formatPeso(budgeted)} budgeted ·{" "}
            {daysToGo === 1 ? "last day" : `${daysToGo} days to go`}
          </p>
          <div
            role="progressbar"
            aria-label="Budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round((used / budgeted) * 100))}
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-sea-deep"
          >
            <div
              className={`h-full rounded-full ${left < 0 ? "bg-coral" : "bg-sun"}`}
              style={{ width: `${Math.min(100, (used / budgeted) * 100)}%` }}
            />
          </div>
        </section>
      )}

      <BudgetManager rows={rows} view={view} custom={custom} />

      {unbudgeted.length > 0 && (
        <p className="text-sm text-muted">
          <strong className="text-ink">No budget:</strong>{" "}
          {unbudgeted
            .map(
              ([key, amount]) =>
                `${categoryInfo("expense", key, custom).label} ${formatPeso(amount)}`,
            )
            .join(" · ")}
        </p>
      )}
    </>
  );
}

function BudgetsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-12 rounded-2xl bg-line-soft" />
      <div className="h-36 rounded-[28px] bg-line-soft" />
      <div className="h-64 rounded-[20px] bg-line-soft" />
    </div>
  );
}

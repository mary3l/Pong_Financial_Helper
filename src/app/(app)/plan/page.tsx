import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ForecastChart } from "@/components/forecast-chart";
import { Pong, type PongMood } from "@/components/pong";
import { categoryInfo } from "@/lib/categories";
import { getPayroll, getPlanInputs } from "@/lib/data";
import { addDays, formatShortDay, today as getToday } from "@/lib/dates";
import { itemEffect, itemLabel, lowestBetween, paidInAdvance, project, type DayBalance } from "@/lib/forecast";
import { formatPeso } from "@/lib/money";
import { billsByPayday } from "@/lib/office-days";
import { PERIOD_DAYS, paymentsByPeriod } from "@/lib/pay-periods";
import { nextOccurrence } from "@/lib/schedule";
import { BillsByPayday, PaymentsByPeriod } from "./payment-sections";
import { PlanTabs, SegmentLinks } from "./plan-tabs";
import { LogButton } from "@/components/log-button";
import { PaidInAdvanceTag } from "@/components/paid-in-advance-tag";

export const metadata = { title: "Plan · Pong Money" };

const RANGES = [30, 60, 90];

// Design canvas 3.1: projected balance from paydays, recurring and planned
// income and expenses, and the low point before payday.
export default function ForecastPage({ searchParams }: PageProps<"/plan">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-5xl">
      <h1 className="font-display text-3xl font-semibold">Plan</h1>
      <PlanTabs current="forecast" />
      <Suspense fallback={<ForecastSkeleton />}>
        <Forecast searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Forecast({ searchParams }: Pick<PageProps<"/plan">, "searchParams">) {
  const params = await searchParams;
  const days = RANGES.find((r) => String(r) === params.days) ?? 30;
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  // Enough items for the pay periods too; the chart and list still stop at `days`.
  const [{ accounts, inWallets, payday, items }, payroll] = await Promise.all([
    getPlanInputs(today, Math.max(days, PERIOD_DAYS)),
    getPayroll(today),
  ]);

  if (!accounts.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
        <Pong mood="ask" size={110} decorative />
        <p className="max-w-xs text-[15px] text-muted">
          Add your wallets first. I&apos;ll project your balance from there.
        </p>
        <Link href="/setup" className="font-extrabold text-sea-dark underline">Set up wallets</Link>
      </div>
    );
  }

  const forecast = project(inWallets, items, today, days);
  const nextPayday = payday ? nextOccurrence(payday, today) : null;
  const end = addDays(today, days);
  const paydays = items.filter((i) => i.kind === "payday" && i.dueOn < end).map((i) => i.dueOn);
  const periods = paymentsByPeriod({ items, today, nextPayday });
  // Office days need the payroll calculator, which pays each cutoff on its own payday.
  const records = payroll && payroll !== "missing" ? payroll : null;
  const byPayday = payday ? billsByPayday({ items, today, payday, inWallets, payroll: records }) : [];
  const weekOut = addDays(today, 7);
  const lowBeforePayday = nextPayday ? lowestBetween(forecast.days, today, nextPayday) : null;
  const headsUp = lowBeforePayday ?? forecast.lowest;
  const pong = headsUpMood(headsUp, inWallets);

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="flex flex-col gap-4">
        <SegmentLinks
          label="Forecast range"
          options={RANGES.map((r) => ({ href: `/plan?days=${r}`, label: `${r} days`, current: r === days }))}
        />

        <section className="flex flex-col gap-2 rounded-[20px] bg-card px-4 pt-4 pb-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold">Projected balance</h2>
            <span className="text-sm font-bold text-muted">now {formatPeso(inWallets)}</span>
          </div>
          <ForecastChart
            days={forecast.days}
            paydays={paydays}
            low={forecast.lowest}
            height={170}
            label={`Projected balance for the next ${days} days, from ${formatPeso(inWallets)} today. Lowest ${formatPeso(forecast.lowest.balance)} on ${formatShortDay(forecast.lowest.date, today)}.`}
          />
          <div className="flex justify-between text-xs font-bold text-muted">
            <span>Today</span>
            <span>{formatShortDay(addDays(today, days - 1), today)}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-sea" />Balance</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-0 border-l-2 border-dashed border-sun" />Payday</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2 border-dashed border-muted" />₱0</span>
          </div>
        </section>

        <section className="flex items-center gap-2 rounded-[20px] bg-card py-2 pr-4 pl-2">
          <Pong mood={pong} size={64} decorative />
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[13px] font-extrabold text-muted">HEADS UP</h2>
            <p className="text-[15px] leading-snug">
              {lowBeforePayday ? "Lowest point before payday is " : "Lowest point is "}
              <strong className={headsUp.balance < 0 ? "text-coral-text" : ""}>
                {formatPeso(headsUp.balance)} on {formatShortDay(headsUp.date, today)}
              </strong>
              {nextPayday && headsUp.date === addDays(nextPayday, -1) ? ", the day before payday." : "."}
              {headsUp.balance < 0 && " You'd run out before then. Move a bill, or wait on big buys."}
            </p>
            {payday && payday.amount === null && (
              <p className="text-[13px] text-muted">
                Your net pay isn&apos;t saved, so paydays add nothing here.{" "}
                <Link href="/settings/payday" className="font-extrabold text-sea-dark underline">Add it</Link>
              </p>
            )}
            {!payday && (
              <p className="text-[13px] text-muted">
                No payday set.{" "}
                <Link href="/settings/payday" className="font-extrabold text-sea-dark underline">Set payday</Link>
              </p>
            )}
          </div>
        </section>

        <Link
          href="/plan/afford"
          className="flex h-[52px] items-center justify-center rounded-[18px] bg-sun font-extrabold text-ink"
        >
          Can I afford this?
        </Link>

        {byPayday.some((p) => p.bills.length || p.paidEarly.length) && <BillsByPayday periods={byPayday} accounts={accounts} today={today} />}

        {periods.some((p) => p.payments.length) && (
          <PaymentsByPeriod periods={periods} accounts={accounts} today={today} />
        )}
      </div>

      <section aria-labelledby="coming-heading" className="flex flex-col gap-2.5">
        <h2 id="coming-heading" className="font-display text-xl font-semibold">What&apos;s coming</h2>
        <div className="rounded-[20px] bg-card px-4 py-1.5">
          {forecast.rows.length ? (
            <ul className="flex flex-col">
              {forecast.rows.map(({ item, date, balanceAfter }) => {
                const change = itemEffect(item);
                const late = item.dueOn < today;
                // A week out, only money going out gets a button: pay it early, from what you have now.
                const soon = date < weekOut;
                const payEarly = !soon && item.flow === "out" && item.amount !== null;
                return (
                  <li key={item.key} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-line-soft py-2.5 last:border-0">
                    <span className={`row-span-2 text-xs font-extrabold uppercase ${late ? "text-coral-text" : "text-muted"}`}>
                      {late ? "Late" : formatShortDay(date, today)}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                      <span className={`truncate ${item.kind === "payday" ? "font-extrabold" : "font-bold"}`}>
                        {item.name}
                        {item.estimate && <span className="font-normal text-muted"> (est.)</span>}
                      </span>
                      {paidInAdvance(item) && <PaidInAdvanceTag paidOn={item.paidOn!} today={today} />}
                    </span>
                    <span className={`text-right font-display text-[17px] font-semibold ${change > 0 ? "text-sea" : ""}`}>
                      {item.amount === null ? "amount not set" : `${change > 0 ? "+" : "−"}${formatPeso(item.amount)}`}
                    </span>
                    <span className="text-[13px] text-muted">
                      {itemLabel(item)}
                      {item.category && item.kind !== "payday" && ` · ${categoryInfo(item.flow === "in" ? "income" : "expense", item.category).label}`}
                      {item.boughtOn &&
                        ` · bought ${formatShortDay(item.boughtOn, today)} on ${accounts.find((a) => a.id === item.lenderId)?.name ?? "your card"}, paid with its bill`}
                      {" · "}balance after{" "}
                      <span className={balanceAfter < 0 ? "font-bold text-coral-text" : ""}>{formatPeso(balanceAfter)}</span>
                    </span>
                    <span className="flex items-center justify-end gap-1">
                      {(item.kind === "planned" || item.kind === "bill" || item.kind === "income") && (
                        <Link
                          href={`/plan/scheduled?edit=${item.id}`}
                          aria-label={`Edit ${item.name}`}
                          className="flex h-9 items-center rounded-full px-2.5 text-[13px] font-extrabold text-sea-dark hover:bg-mint"
                        >
                          Edit
                        </Link>
                      )}
                      {(soon || payEarly || item.transactionId) && <LogButton item={item} accounts={accounts} early={payEarly} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-3 text-[15px] text-muted">
              Nothing scheduled in the next {days} days.{" "}
              <Link href="/plan/scheduled" className="font-extrabold text-sea-dark underline">Add income &amp; expenses</Link>
            </p>
          )}
        </div>
        <p className="text-xs text-muted">
          Counts cash, bank and e-wallets. Anything you&apos;ve marked paid or added is already in your
          balance. <Link href="/plan/scheduled" className="font-extrabold text-sea-dark underline">Manage scheduled</Link>
        </p>
      </section>
    </div>
  );
}

function headsUpMood(low: DayBalance, start: number): PongMood {
  if (low.balance < 0) return "shocked";
  if (low.balance < start * 0.15) return "worried";
  return "happy";
}

function ForecastSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-12 rounded-2xl bg-line-soft" />
      <div className="h-56 rounded-[20px] bg-line-soft" />
      <div className="h-24 rounded-[20px] bg-line-soft" />
    </div>
  );
}

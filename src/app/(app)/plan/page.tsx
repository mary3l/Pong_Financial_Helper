import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ForecastChart } from "@/components/forecast-chart";
import { Pong, type PongMood } from "@/components/pong";
import { DEBT_SHARE } from "@/lib/bnpl";
import { categoryInfo } from "@/lib/categories";
import { getPlanInputs, type Account } from "@/lib/data";
import { addDays, formatShortDay, today as getToday } from "@/lib/dates";
import { itemEffect, itemLabel, lowestBetween, project, type DayBalance } from "@/lib/forecast";
import { formatPeso } from "@/lib/money";
import { PERIOD_DAYS, paymentsByPeriod, type PeriodPayments } from "@/lib/pay-periods";
import { nextOccurrence } from "@/lib/schedule";
import { PlanTabs, SegmentLinks } from "./plan-tabs";
import { LogButton } from "@/components/log-button";

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
  const { accounts, inWallets, payday, items } = await getPlanInputs(today, Math.max(days, PERIOD_DAYS));

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
                <Link href="/setup/payday?from=settings" className="font-extrabold text-sea-dark underline">Add it</Link>
              </p>
            )}
            {!payday && (
              <p className="text-[13px] text-muted">
                No payday set.{" "}
                <Link href="/setup/payday?from=settings" className="font-extrabold text-sea-dark underline">Set payday</Link>
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
                return (
                  <li key={item.key} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-line-soft py-2.5 last:border-0">
                    <span className={`row-span-2 text-xs font-extrabold uppercase ${late ? "text-coral-text" : "text-muted"}`}>
                      {late ? "Late" : formatShortDay(date, today)}
                    </span>
                    <span className={`truncate ${item.kind === "payday" ? "font-extrabold" : "font-bold"}`}>
                      {item.name}
                      {item.estimate && <span className="font-normal text-muted"> (est.)</span>}
                    </span>
                    <span className={`text-right font-display text-[17px] font-semibold ${change > 0 ? "text-sea" : ""}`}>
                      {item.amount === null ? "amount not set" : `${change > 0 ? "+" : "−"}${formatPeso(item.amount)}`}
                    </span>
                    <span className="text-[13px] text-muted">
                      {itemLabel(item)}
                      {item.category && item.kind !== "payday" && ` · ${categoryInfo(item.flow === "in" ? "income" : "expense", item.category).label}`}
                      {" · "}balance after{" "}
                      <span className={balanceAfter < 0 ? "font-bold text-coral-text" : ""}>{formatPeso(balanceAfter)}</span>
                    </span>
                    {date < weekOut ? <LogButton item={item} accounts={accounts} /> : <span />}
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

/** Every BNPL and loan payment, a month at a time from payday, against the pay that comes in. */
function PaymentsByPeriod({ periods, accounts, today }: { periods: PeriodPayments[]; accounts: Account[]; today: string }) {
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "Other";
  return (
    <section aria-labelledby="periods-heading" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 id="periods-heading" className="font-display text-xl font-semibold">BNPL &amp; loan payments</h2>
        <p className="text-[13px] text-muted">By pay period, against the pay coming in.</p>
      </div>
      <div className="flex flex-col gap-2">
        {periods.map((p, index) => {
          const percent = p.share === null ? null : Math.round(p.share * 100);
          const bar = p.share === null ? "" : p.share > 0.5 ? "bg-coral" : p.share > DEBT_SHARE ? "bg-sun" : "bg-sea";
          return (
            <details key={p.from} open={index === 0} className="group rounded-[20px] bg-card px-4 py-3">
              <summary className="flex cursor-pointer list-none flex-col gap-1.5 [&::-webkit-details-marker]:hidden">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-bold">
                    {formatShortDay(p.from, today)} – {formatShortDay(p.to, today)}
                  </span>
                  <span className="font-display text-[19px] font-semibold">{formatPeso(p.total)}</span>
                </span>
                {percent !== null ? (
                  <>
                    <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-line-soft">
                      <span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, percent)}%` }} />
                    </span>
                    <span className="flex justify-between gap-3 text-[13px] text-muted">
                      <span className={p.share! > 0.5 ? "font-extrabold text-coral-text" : ""}>
                        {percent}% of {formatPeso(p.income)} pay
                      </span>
                      <span className="font-extrabold text-sea-dark group-open:hidden">Show</span>
                      <span className="hidden font-extrabold text-sea-dark group-open:inline">Hide</span>
                    </span>
                  </>
                ) : (
                  <span className="flex justify-between gap-3 text-[13px] text-muted">
                    <span>{p.payments.length ? "No pay comes in these days" : "Nothing due"}</span>
                    <span className="font-extrabold text-sea-dark group-open:hidden">Show</span>
                    <span className="hidden font-extrabold text-sea-dark group-open:inline">Hide</span>
                  </span>
                )}
              </summary>
              {p.payments.length > 0 && (
                <>
                  <ul className="mt-2 flex flex-col border-t border-line-soft">
                    {p.payments.map((item) => {
                      const late = item.dueOn < today;
                      return (
                        <li key={item.key} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-line-soft py-2 last:border-0">
                          <span className={`text-xs font-extrabold uppercase ${late ? "text-coral-text" : "text-muted"}`}>
                            {late ? "Late" : formatShortDay(item.dueOn, today)}
                          </span>
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className="truncate font-bold">{item.name}</span>
                            {item.lastPayment && (
                              <span className="rounded-full bg-sea-tint px-2 text-xs font-extrabold text-sea-dark">Last payment</span>
                            )}
                          </span>
                          <span className="text-right font-display text-[17px] font-semibold">{formatPeso(item.amount ?? 0)}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="pt-2 text-[13px] text-muted">
                    {p.byLender.map((l) => `${name(l.lenderId)} ${formatPeso(l.total)}`).join(" · ")}
                  </p>
                </>
              )}
            </details>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Installments and loan payments set up in Pong. Bills are in What&apos;s coming, and split
        bills that aren&apos;t on a credit line&apos;s bill yet aren&apos;t here. Pay is your
        Payroll estimate until it comes in.
      </p>
    </section>
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

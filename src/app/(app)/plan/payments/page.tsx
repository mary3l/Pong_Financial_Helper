import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { LogButton } from "@/components/log-button";
import { PaidInAdvanceTag } from "@/components/paid-in-advance-tag";
import { getCapLines, getCashSpentToday, getPlanInputs, getTransactions, type Account } from "@/lib/data";
import { addDays, formatRelativeDay, formatShortDay, today as getToday } from "@/lib/dates";
import { paidInAdvance, type ForecastItem } from "@/lib/forecast";
import { formatPeso } from "@/lib/money";
import {
  breathers,
  earliestToPay,
  isBnplBill,
  nextSegment,
  planToday,
  PLAN_DAYS,
  type PaymentPlan,
} from "@/lib/payment-plan";
import { PlanTabs } from "../plan-tabs";

export const metadata = { title: "Payments · Pong Money" };

// The payment plan: Pong's daily amount, then every payment in order. Pay is
// green when it's safe to pay today (even early), grey with the first safe
// day when it isn't; BNPL bills only on their due day, with each bill's cap
// for new buys held on it. A long gap with nothing due gets a "Breathe" line.
export default function PaymentsPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Plan</h1>
      <PlanTabs current="payments" />
      <Suspense fallback={<PaymentsSkeleton />}>
        <Payments />
      </Suspense>
    </div>
  );
}

async function Payments() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [{ accounts, inWallets, items }, todays] = await Promise.all([
    getPlanInputs(today, PLAN_DAYS),
    getTransactions({ from: today, to: today }),
  ]);
  if (!accounts.length) {
    return (
      <p className="rounded-[20px] bg-card px-4 py-3 text-[15px] text-muted">
        Add your wallets first.{" "}
        <Link href="/setup" className="font-extrabold text-sea-dark underline">Set up wallets</Link>
      </p>
    );
  }
  const [cash, lines] = await Promise.all([getCashSpentToday(todays, accounts), getCapLines(accounts, today)]);
  const { plan, held, capPerDay } = planToday({ inWallets, cash, items, today, lines });
  const next = nextSegment(plan);
  const end = addDays(today, PLAN_DAYS);
  const creditLines = new Set(accounts.filter((a) => a.type === "credit_line").map((a) => a.id));
  const shown = [...items, ...held].filter((i) => i.amount !== null && i.dueOn < end);
  const dateOf = (i: ForecastItem) => (i.dueOn < today ? today : i.dueOn);
  const dates = [...new Set(shown.map(dateOf))].sort();
  const balance = new Map(plan.days.map((d) => [d.date, d.balance]));
  const gaps = breathers(dates, today);
  const gapAfter = (date: string | null) => gaps.find((g) => g.after === date);

  return (
    <div className="flex flex-col gap-2">
      <section className="flex flex-col gap-2.5 rounded-[20px] bg-sea p-4 text-white">
        <div className="grid grid-cols-2 gap-2">
          <Stretch label={`Now – ${formatShortDay(addDays(plan.segments[0].until, -1), today)}`} perDay={plan.perDay} />
          {next && <Stretch label={`From ${formatShortDay(next.from, today)}`} perDay={next.perDay} />}
        </div>
        <p className="text-[13px] text-sea-text">
          {plan.short
            ? "Short · bills ahead need more than you have"
            : `Lowest ${formatPeso(plan.lowest.balance)} · ${formatShortDay(plan.lowest.date, today)}`}
          {lines.length > 0 && ` · BNPL ${formatPeso(capPerDay)} a day each`}
        </p>
      </section>

      {gapAfter(null) && <Breathe days={gapAfter(null)!.days} />}
      {dates.map((date) => {
        const gap = gapAfter(date);
        return (
          <div key={date} className="flex flex-col gap-2">
            <section aria-label={formatRelativeDay(date, today)} className="rounded-[20px] bg-card px-4 py-2">
              <div className="flex items-baseline justify-between gap-3 py-1">
                <h2 className="font-display text-[17px] font-semibold">{formatRelativeDay(date, today)}</h2>
                {balance.has(date) && (
                  <span className={`text-[13px] font-bold ${balance.get(date)! < 0 ? "text-coral-text" : "text-muted"}`}>
                    {formatPeso(balance.get(date)!)} left
                  </span>
                )}
              </div>
              <ul className="flex flex-col">
                {shown
                  .filter((i) => dateOf(i) === date)
                  .sort((a, b) => (a.flow === b.flow ? 0 : a.flow === "in" ? -1 : 1))
                  .map((item) => (
                    <PaymentRow key={item.key} item={item} plan={plan} accounts={accounts} creditLines={creditLines} today={today} />
                  ))}
              </ul>
            </section>
            {gap && <Breathe days={gap.days} />}
          </div>
        );
      })}
    </div>
  );
}

function Stretch({ label, perDay }: { label: string; perDay: number }) {
  return (
    <div className="rounded-[14px] bg-sea-deep px-3 py-2">
      <p className="text-xs font-extrabold text-sea-text">{label}</p>
      <p className="font-display text-[22px] font-semibold">{formatPeso(perDay)} a day</p>
    </div>
  );
}

function Breathe({ days }: { days: number }) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-1 text-sea-dark" role="note">
      <span aria-hidden="true" className="flex-1 border-t-2 border-dashed border-line" />
      <span className="text-xs font-extrabold whitespace-nowrap">Breathe · {days} days</span>
      <span aria-hidden="true" className="flex-1 border-t-2 border-dashed border-line" />
    </div>
  );
}

function PaymentRow({
  item,
  plan,
  accounts,
  creditLines,
  today,
}: {
  item: ForecastItem;
  plan: PaymentPlan;
  accounts: Account[];
  creditLines: Set<string>;
  today: string;
}) {
  if (item.key.startsWith("cap|")) {
    // What's still open of a BNPL bill's cap, held on its due day.
    return (
      <li className="flex items-center gap-3 border-t border-line-soft py-2.5">
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="truncate font-bold text-muted">{item.name}</span>
          <span className="rounded-full bg-sun-tint px-2 text-xs font-extrabold text-sun-text">Cap</span>
        </span>
        <span className="font-display text-[17px] font-semibold text-muted">up to {formatPeso(item.amount!)}</span>
      </li>
    );
  }
  const incoming = item.flow === "in";
  const paid = Boolean(item.transactionId);
  const late = !paid && item.dueOn < today;
  const wallet = accounts.find((a) => a.id === item.accountId)?.name;
  // BNPL bills stay on their due day; everything else can go early when there's room.
  const earliest = incoming || paid || item.dueOn <= today ? today : isBnplBill(item, creditLines) ? item.dueOn : earliestToPay(item, plan, today);
  return (
    <li className="flex items-center gap-3 border-t border-line-soft py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`truncate font-bold ${paid ? "text-muted line-through" : incoming ? "text-sea-dark" : ""}`}>{item.name}</span>
          {late && <span className="rounded-full bg-coral-tint px-2 text-xs font-extrabold text-coral-text">Late</span>}
          {!paid && !incoming && (item.fee ?? 0) >= 1 ? (
            <span className="rounded-full bg-sea-tint px-2 text-xs font-extrabold text-sea-dark">Strategic</span>
          ) : null}
          {paidInAdvance(item) && <PaidInAdvanceTag paidOn={item.paidOn!} today={today} />}
        </span>
        {wallet && <span className="text-[13px] text-muted">{wallet}</span>}
      </span>
      <span className={`font-display text-[17px] font-semibold ${paid ? "text-muted line-through" : incoming ? "text-sea" : ""}`}>
        {incoming ? "+" : ""}
        {formatPeso(item.amount!)}
      </span>
      {incoming ? null : earliest === today || paid ? (
        <LogButton item={item} accounts={accounts} label={paid ? undefined : "Pay"} />
      ) : (
        <span className="flex shrink-0 flex-col items-center gap-0.5">
          <span
            aria-disabled="true"
            title={`Safe to pay from ${formatShortDay(earliest, today)}`}
            className="flex h-10 min-w-[100px] items-center justify-center rounded-full bg-key px-3 text-[13px] font-extrabold text-muted"
          >
            Pay
          </span>
          <span className="text-xs font-extrabold text-muted">{formatShortDay(earliest, today)}</span>
        </span>
      )}
    </li>
  );
}

function PaymentsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="h-28 rounded-[20px] bg-line-soft" />
      <div className="h-40 rounded-[20px] bg-line-soft" />
      <div className="h-40 rounded-[20px] bg-line-soft" />
    </div>
  );
}

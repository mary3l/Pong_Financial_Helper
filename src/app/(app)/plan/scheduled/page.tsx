import { connection } from "next/server";
import { Suspense } from "react";
import { getScheduled } from "@/lib/data";
import { today as getToday } from "@/lib/dates";
import { PlanTabs } from "../plan-tabs";
import { ScheduledManager } from "./scheduled-manager";

export const metadata = { title: "Scheduled · Pong Money" };

// Recurring and planned income and expenses: payroll, allowance, rent,
// tuition, a 13th month pay. They feed the forecast as anticipated
// cashflows; "Add income" / "Mark paid" logs the real transaction when it
// happens.
export default function ScheduledPage({ searchParams }: PageProps<"/plan/scheduled">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-5xl">
      <h1 className="font-display text-3xl font-semibold">Plan</h1>
      <PlanTabs current="scheduled" />
      <Suspense>
        <JustAdded searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ScheduledSkeleton />}>
        <Scheduled searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Scheduled({ searchParams }: Pick<PageProps<"/plan/scheduled">, "searchParams">) {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [{ edit }, { accounts, recurring, planned, items, payroll }] = await Promise.all([searchParams, getScheduled(today)]);
  return (
    <ScheduledManager
      accounts={accounts}
      recurring={recurring}
      planned={planned.filter((p) => p.dueOn >= today || !p.transactionId)}
      items={items}
      payroll={payroll}
      today={today}
      // Edit on Plan's rows: opens that item's form.
      startEditing={typeof edit === "string" ? edit : null}
    />
  );
}

/** After "Add as planned expense" in Can I afford this? (?added=3 for 3 installments). */
async function JustAdded({ searchParams }: Pick<PageProps<"/plan/scheduled">, "searchParams">) {
  const { added } = await searchParams;
  const count = Number(added);
  if (!Number.isInteger(count) || count < 1 || count > 24) return null;
  return (
    <p role="status" className="rounded-[20px] bg-sea-tint px-4 py-3 text-[15px] leading-relaxed">
      <strong>Added to Money going out.</strong>{" "}
      {count > 1
        ? `It's ${count} payments below, one per month ("1 of ${count}" and so on). Tap one to change its amount or date, or to remove it.`
        : "Tap it below to change the amount, date or name, or to remove it."}
    </p>
  );
}

function ScheduledSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2" aria-hidden="true">
      <div className="h-64 rounded-[20px] bg-line-soft" />
      <div className="h-64 rounded-[20px] bg-line-soft" />
    </div>
  );
}

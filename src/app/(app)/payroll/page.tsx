import { connection } from "next/server";
import { Suspense } from "react";
import { getPayroll, getRecurringItems } from "@/lib/data";
import { isValidDate, periodContaining, today as getToday } from "@/lib/dates";
import { PayrollManager } from "./payroll-manager";

export const metadata = { title: "Payroll calculator · Pong Money" };

// Works out each payday from a daily rate, the days you worked, late minutes
// and overtime, and keeps SSS, PhilHealth, Pag-IBIG and the 8% income tax in
// Money going out. ?cutoff=2026-11-16 opens that cutoff.
export default function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-4xl">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Payroll calculator</h1>
        <p className="text-[15px] text-muted">
          Your pay from the days you worked, minus late, plus overtime. Nothing is deducted
          from it, so your contributions and tax go into Money going out.
        </p>
      </div>
      <Suspense fallback={<div className="h-96 rounded-[20px] bg-line-soft" aria-hidden="true" />}>
        <Payroll searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Payroll({ searchParams }: Pick<PageProps<"/payroll">, "searchParams">) {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [{ cutoff }, payroll, recurring] = await Promise.all([searchParams, getPayroll(today), getRecurringItems()]);
  const picked = typeof cutoff === "string" && isValidDate(cutoff) ? cutoff : today;
  const payday = recurring.find((r) => r.kind === "payday") ?? null;
  // The day each SSS, PhilHealth and Pag-IBIG bill is due: which pay it comes out of.
  const contributionDays = Object.fromEntries(recurring.filter((r) => r.payrollKey).map((r) => [r.payrollKey!, r.day1]));

  return (
    <PayrollManager
      key={periodContaining(picked).start}
      today={today}
      period={periodContaining(picked)}
      records={payroll === "missing" ? null : payroll}
      missing={payroll === "missing"}
      contributionDays={contributionDays}
      payday={payday?.frequency === "twice_monthly" ? { frequency: payday.frequency, day1: payday.day1, day2: payday.day2 } : null}
    />
  );
}

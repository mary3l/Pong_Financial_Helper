import { connection } from "next/server";
import { Suspense } from "react";
import { getInstallmentPlans, getPayroll, getRecurringItems } from "@/lib/data";
import { isValidDate, today as getToday } from "@/lib/dates";
import { cutoffContaining, cutoffRuleOf, pageRule, salaryLoansOf } from "@/lib/payroll";
import { PayrollManager } from "./payroll-manager";

export const metadata = { title: "Pay · Pong Money" };

// Works out each payday from a daily rate, the days you worked, late minutes
// and overtime, minus contributions your office takes (GSIS), and keeps SSS,
// PhilHealth, Pag-IBIG and the 8% income tax you pay yourself in Money going
// out. ?cutoff=2026-11-18 opens the cutoff with that day.
export default function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-4xl">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Pay</h1>
        <p className="text-[15px] text-muted">Gross pay − what your office takes = each payday</p>
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
  const [{ cutoff }, payroll, recurring, plans] = await Promise.all([
    searchParams,
    getPayroll(today),
    getRecurringItems(),
    getInstallmentPlans(),
  ]);
  const picked = typeof cutoff === "string" && isValidDate(cutoff) ? cutoff : today;
  const payday = recurring.find((r) => r.kind === "payday") ?? null;
  // Cutoffs follow your payday: weeks, months, or your own two a month (3–17
  // and 18–2), moved ones included. Daily pay shows a week at a time.
  const settings = payroll && payroll !== "missing" ? payroll.settings : {};
  const period = cutoffContaining(
    picked,
    pageRule(cutoffRuleOf({ ...settings, frequency: payday?.frequency })),
  );
  // The day each SSS, PhilHealth and Pag-IBIG bill is due: which pay it comes out of.
  const contributionDays = Object.fromEntries(
    recurring.filter((r) => r.payrollKey).map((r) => [r.payrollKey!, r.day1]),
  );

  return (
    <PayrollManager
      key={period.start}
      today={today}
      period={period}
      records={
        payroll === "missing" || !payroll ? null : { ...payroll, salaryLoans: salaryLoansOf(plans) }
      }
      missing={payroll === "missing"}
      contributionDays={contributionDays}
      payday={
        payday
          ? {
              frequency: payday.frequency,
              day1: payday.day1,
              day2: payday.day2,
              weeks: payday.weeks,
              weekdays: payday.weekdays,
            }
          : null
      }
    />
  );
}

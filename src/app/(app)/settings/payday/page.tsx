import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PaydayForm } from "@/app/setup/payday/payday-form";
import { getAccounts, getPayroll, getRecurringItems } from "@/lib/data";
import { today as getToday } from "@/lib/dates";

export const metadata = { title: "Payday and bills · Pong Money" };

// Settings › Payday & bills: the setup step's form inside the app, with the
// nav. On a wide screen your payday sits beside your regular bills.
export default function PaydaySettingsPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-5xl">
      <Link href="/settings" className="flex h-10 w-fit items-center font-extrabold text-sea-dark">‹ Settings</Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Payday and regular bills</h1>
        <p className="text-[15px] text-muted">
          These tell me how long your money has to last: Safe to spend, your forecast and Bills by payday.
        </p>
      </div>
      <Suspense fallback={<div className="h-[560px] rounded-3xl bg-line-soft" aria-hidden="true" />}>
        <Payday />
      </Suspense>
    </div>
  );
}

async function Payday() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const [accounts, items, payroll] = await Promise.all([getAccounts(), getRecurringItems(), getPayroll(getToday())]);
  return (
    <PaydayForm
      accounts={accounts}
      payday={items.find((i) => i.kind === "payday") ?? null}
      bills={items.filter((i) => i.kind === "bill" && i.frequency === "monthly" && !i.payrollKey)}
      editing
      payroll={Boolean(payroll && payroll !== "missing")}
    />
  );
}

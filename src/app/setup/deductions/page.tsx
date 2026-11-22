import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getPayroll, getRecurringItems } from "@/lib/data";
import { today as getToday } from "@/lib/dates";
import { isEmployee } from "@/lib/payroll";
import { SetupHeader } from "../setup-header";
import { DeductionsStep } from "./deductions-step";

export const metadata = { title: "Taken from your pay · Pong Money" };

// Step 4 of setup, for employees: GSIS or SSS, PhilHealth, Pag-IBIG and
// withholding tax, as Pong's estimates from your gross pay.
export default function SetupDeductionsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <SetupHeader
        step={4}
        title="Taken from your pay"
        message="Your office takes these before pay lands."
        mood="listen"
      />
      <Suspense fallback={<div className="h-96 rounded-3xl bg-line-soft" />}>
        <Deductions />
      </Suspense>
    </div>
  );
}

async function Deductions() {
  await connection();
  const today = getToday();
  const [payroll, recurring] = await Promise.all([getPayroll(today), getRecurringItems()]);
  const payday = recurring.find((r) => r.kind === "payday");
  // Nothing to take without pay set up, or for the self-employed: on to what you owe.
  if (!payroll || payroll === "missing" || !payday || !isEmployee(payroll.settings.employment))
    redirect("/setup/credit");
  return (
    <DeductionsStep
      settings={payroll.settings}
      saved={(payroll.deductions ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        amount: d.estimated ? null : d.amount,
        ...(d.kind ? { kind: d.kind } : {}),
        ...(d.taken ? { taken: d.taken } : {}),
      }))}
      schedule={payday}
      today={today}
      next="/setup/credit"
    />
  );
}

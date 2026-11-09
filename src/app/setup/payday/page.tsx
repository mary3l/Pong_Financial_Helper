import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccounts, getPayroll, getRecurringItems } from "@/lib/data";
import { today as getToday } from "@/lib/dates";
import { SetupHeader } from "../setup-header";
import { PaydayForm } from "./payday-form";

export const metadata = { title: "Payday and bills · Pong Money" };

// Step 2 of setup. Editing it later is Settings › Payday & bills
// (/settings/payday); old ?from=settings links go there.
export default function SetupPaydayPage({ searchParams }: PageProps<"/setup/payday">) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <Suspense fallback={<div className="h-[560px] rounded-3xl bg-line-soft" />}>
        <Payday searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Payday({ searchParams }: Pick<PageProps<"/setup/payday">, "searchParams">) {
  const { from } = await searchParams;
  if (from === "settings") redirect("/settings/payday");
  const [accounts, items] = await Promise.all([getAccounts(), getRecurringItems()]);
  const payroll = await getPayroll(getToday());

  return (
    <>
      <SetupHeader
        step={2}
        title="Payday and regular bills"
        message="These tell me how long your money has to last. You can change them anytime."
        mood="listen"
      />
      <PaydayForm
        accounts={accounts}
        payday={items.find((i) => i.kind === "payday") ?? null}
        bills={items.filter((i) => i.kind === "bill" && i.frequency === "monthly" && !i.payrollKey)}
        editing={false}
        payroll={Boolean(payroll && payroll !== "missing")}
      />
    </>
  );
}

import { connection } from "next/server";
import { Suspense } from "react";
import { getAccounts } from "@/lib/data";
import { today } from "@/lib/dates";
import { paysInPesos } from "@/lib/money";
import { SetupHeader } from "../setup-header";
import { DebtsStep } from "./debts-step";

export const metadata = { title: "What you owe · Pong Money" };

// Step 3 of setup: BNPL and credit lines (SPayLater, Atome, MariBank) and
// loans you're paying. Their bills are planned for before what's left this week.
export default function SetupCreditPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <SetupHeader
        step={3}
        title="What you owe"
        message="Bills from these come out before what's left this week."
        mood="listen"
      />
      <Suspense fallback={<div className="h-80 rounded-3xl bg-line-soft" />}>
        <Debts />
      </Suspense>
    </div>
  );
}

async function Debts() {
  await connection();
  const accounts = await getAccounts();
  return (
    <DebtsStep
      debts={accounts.filter((a) => a.type === "credit_line" || a.type === "loan")}
      wallets={accounts.filter((a) => paysInPesos(a))}
      today={today()}
    />
  );
}

import { connection } from "next/server";
import { Suspense } from "react";
import { today } from "@/lib/dates";
import { SetupHeader } from "../setup-header";
import { PayStep } from "./pay-step";

export const metadata = { title: "Your pay · Pong Money" };

// Step 3 of setup: gross pay and cutoffs, then when you're paid. Employees
// see what their office takes next; everyone else goes on to what they owe.
export default function SetupPayPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <SetupHeader
        step={3}
        title="Your pay"
        message="Gross pay and cutoffs: I'll work out each payday."
        mood="listen"
      />
      <Suspense fallback={<div className="h-96 rounded-3xl bg-line-soft" />}>
        <Pay />
      </Suspense>
    </div>
  );
}

async function Pay() {
  await connection();
  return (
    <PayStep today={today()} next={{ employee: "/setup/deductions", other: "/setup/credit" }} />
  );
}

import { Suspense } from "react";
import { getAccounts } from "@/lib/data";
import { SetupHeader } from "../setup-header";
import { WalletsForm } from "../wallets-form";

export const metadata = { title: "Savings · Pong Money" };

// Step 2 of setup: savings, emergency fund and investments. They count in
// net worth but not in what's left this week, so you won't plan to spend them.
export default function SetupSavingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <SetupHeader
        step={2}
        title="Money you're saving"
        message="Savings stay out of what's left this week."
        mood="happy"
      />
      <Suspense fallback={<div className="h-80 rounded-3xl bg-line-soft" />}>
        <Savings />
      </Suspense>
    </div>
  );
}

async function Savings() {
  const accounts = await getAccounts();
  return <WalletsForm existing={accounts} purpose="saved" next="/setup/credit" />;
}

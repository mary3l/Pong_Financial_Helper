import { Suspense } from "react";
import { getAccounts } from "@/lib/data";
import { SetupHeader } from "./setup-header";
import { WalletsForm } from "./wallets-form";

export const metadata = { title: "Set up wallets · Pong Money" };

export default function SetupWalletsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <SetupHeader
        step={1}
        title="Where do you keep your money?"
        message="Add each wallet and how much is in it right now. Skip any you don't use."
        mood="ask"
      />
      <Suspense fallback={<div className="h-80 rounded-3xl bg-line-soft" />}>
        <Wallets />
      </Suspense>
    </div>
  );
}

async function Wallets() {
  const accounts = await getAccounts();
  return <WalletsForm existing={accounts} next="/setup/savings" />;
}

import { connection } from "next/server";
import { Suspense } from "react";
import { getAccounts, getLastInterest } from "@/lib/data";
import { today as getToday } from "@/lib/dates";
import { getUsdRate } from "@/lib/fx";
import { formatPeso, isSpendable, pesoTotal } from "@/lib/money";
import { MoneyTabs } from "../money-tabs";
import { WalletManager } from "../wallet-manager";
import { isSavingsWallet, walletInterest } from "../wallet-totals";

export const metadata = { title: "Savings · Money · Pong Money" };

// Money set aside, apart from spending wallets: savings, emergency fund,
// investments and dollar time deposits, with their interest and goals.
export default function SavingsPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-6xl">
      <h1 className="font-display text-3xl font-semibold">Money</h1>
      <MoneyTabs current="savings" />
      <Suspense fallback={<div className="h-80 rounded-[20px] bg-line-soft" />}>
        <Savings />
      </Suspense>
    </div>
  );
}

async function Savings() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [accounts, lastInterest, usdRate] = await Promise.all([getAccounts(), getLastInterest(), getUsdRate()]);
  const saved = accounts.filter((a) => !a.archived && isSpendable(a.type) && isSavingsWallet(a));
  const { accrued, perMonth } = walletInterest(saved, lastInterest, today);
  // Dollars count at the rate set on each wallet.
  const total = pesoTotal(saved);

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <section aria-labelledby="savings-heading" className="flex flex-col gap-2">
        <h2 id="savings-heading" className="text-[13px] font-extrabold text-muted">
          SAVINGS · {formatPeso(total)}
          {perMonth > 0 && ` · earning ≈ ${formatPeso(perMonth)}/mo in interest`}
        </h2>
        <WalletManager
          accounts={saved}
          accrued={accrued}
          today={today}
          usdRate={usdRate?.rate ?? null}
          purposes={["savings", "emergency", "investment"]}
        />
      </section>
      <aside aria-label="About savings" className="flex flex-col gap-2 rounded-[20px] bg-card p-4 text-[15px] leading-relaxed">
        <h2 className="font-display text-xl font-semibold">Set aside, not spent</h2>
        <p className="text-muted">
          Savings, your emergency fund, investments and dollar deposits count in Net worth,
          but not in You have or Safe to spend, so you won&apos;t plan to spend them.
        </p>
        <p className="text-muted">
          Give one a goal, like a GoTyme GoalSave, and Pong works out what to put in each day, week or month.
          Moving money here from a spending wallet is a transfer, never spending.
        </p>
      </aside>
    </div>
  );
}

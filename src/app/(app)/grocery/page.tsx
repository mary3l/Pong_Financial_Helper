import { connection } from "next/server";
import { Suspense } from "react";
import { getAccounts, getBudgets, getPriceMemory, getTransactions } from "@/lib/data";
import { periodContaining, today as getToday } from "@/lib/dates";
import { paysInPesos, roundCents } from "@/lib/money";
import { GroceryMode } from "./grocery-mode";

export const metadata = { title: "Grocery mode · Pong Money" };

// Design canvas 6.1–6.3: start a trip with a budget, scan as you shop, then
// check out with the receipt total as ONE Groceries expense.
export default function GroceryPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-xl">
      <Suspense fallback={<div className="h-[640px] rounded-[20px] bg-line-soft" />}>
        <Grocery />
      </Suspense>
    </div>
  );
}

async function Grocery() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const period = periodContaining(today);
  const [accounts, budgets, spent, { memory, stores }] = await Promise.all([
    getAccounts(),
    getBudgets(),
    getTransactions({ from: period.start, to: period.end, search: "groceries" }),
    getPriceMemory(),
  ]);
  const budget = budgets.find((b) => b.category === "groceries");
  const used = roundCents(
    spent
      .filter((t) => t.type === "expense" && t.category === "groceries")
      .reduce((sum, t) => sum + t.amount, 0),
  );

  return (
    <GroceryMode
      wallets={accounts.filter((a) => paysInPesos(a) || a.type === "credit_line")}
      groceriesLeft={budget ? Math.max(0, roundCents(budget.amount - used)) : null}
      groceriesBudget={budget?.amount ?? null}
      memory={memory}
      stores={stores}
      today={today}
    />
  );
}

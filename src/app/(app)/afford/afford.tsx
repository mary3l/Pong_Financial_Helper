import { connection } from "next/server";
import { creditRoom } from "@/lib/bnpl";
import { getBnplCap, getPlanInputs } from "@/lib/data";
import { today as getToday } from "@/lib/dates";
import { nextUnreceivedPayday } from "@/lib/forecast";
import { countsAsSpending, paysInPesos } from "@/lib/money";
import { AffordForm } from "./afford-form";

// Installments can run up to a year past the purchase date.
const HORIZON_DAYS = 420;

/**
 * Can I afford this? (design canvas 3.2): test a purchase against the
 * forecast. Loads the plan; render it inside <Suspense>.
 */
export async function Afford({ mode }: { mode: "modal" | "page" }) {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const plan = await getPlanInputs(today, HORIZON_DAYS);
  const { accounts, inWallets, payday, items } = plan;
  const credit = creditRoom(accounts);
  const cap = credit.length ? await getBnplCap(today, plan) : null;
  return (
    <AffordForm
      mode={mode}
      start={inWallets}
      items={items}
      today={today}
      nextPayday={payday ? nextUnreceivedPayday(payday, items, today) : null}
      payKnown={Boolean(payday?.amount)}
      payday={payday ? { frequency: payday.frequency, day1: payday.day1, day2: payday.day2 } : null}
      credit={credit}
      cap={cap}
      // Your spending money: what the forecast counts.
      wallets={accounts
        .filter((a) => countsAsSpending(a) && paysInPesos(a) && !a.archived)
        .map((a) => ({ id: a.id, name: a.name, balance: a.balance }))}
    />
  );
}

export function AffordSkeleton({ mode }: { mode: "modal" | "page" }) {
  return (
    <div
      aria-busy="true"
      className={`flex flex-col gap-4 lg:flex-row lg:gap-6 ${mode === "modal" ? "p-5 lg:p-7" : ""}`}
    >
      <div className="h-96 flex-1 rounded-[20px] bg-line-soft" />
      <div className="hidden h-96 flex-1 rounded-[20px] bg-line-soft lg:block" />
    </div>
  );
}

import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronIcon } from "@/components/icons";
import { creditRoom } from "@/lib/bnpl";
import { getBnplCap, getPlanInputs } from "@/lib/data";
import { today as getToday } from "@/lib/dates";
import { nextOccurrence } from "@/lib/schedule";
import { AffordForm } from "./afford-form";

export const metadata = { title: "Can I afford this? · Pong Money" };

// Installments can run up to a year past the purchase date.
const HORIZON_DAYS = 420;

// Design canvas 3.2: test a purchase against the forecast before spending.
export default function AffordPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-4xl">
      <Link href="/plan" className="flex h-11 items-center gap-1 self-start font-bold text-sea-dark">
        <ChevronIcon direction="left" size={20} />
        Forecast
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Can I afford this?</h1>
        <p className="text-[15px] text-muted">Test a purchase against your forecast before you spend.</p>
      </div>
      <Suspense fallback={<div className="h-96 rounded-[20px] bg-line-soft" aria-hidden="true" />}>
        <Afford />
      </Suspense>
    </div>
  );
}

async function Afford() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const plan = await getPlanInputs(today, HORIZON_DAYS);
  const { accounts, inWallets, payday, items } = plan;
  const credit = creditRoom(accounts);
  const cap = credit.length ? await getBnplCap(today, plan) : null;
  return (
    <AffordForm
      start={inWallets}
      items={items}
      today={today}
      nextPayday={payday ? nextOccurrence(payday, today) : null}
      payKnown={Boolean(payday?.amount)}
      payday={payday ? { frequency: payday.frequency, day1: payday.day1, day2: payday.day2 } : null}
      credit={credit}
      cap={cap}
    />
  );
}

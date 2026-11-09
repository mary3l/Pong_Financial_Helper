import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAccounts, getPeople } from "@/lib/data";
import { today } from "@/lib/dates";
import { paysInPesos } from "@/lib/money";
import { LoanForm } from "./loan-form";

export const metadata = { title: "Add loan · Pong Money" };

// Design canvas 4.3: SLoan, MariLoan or any loan you pay monthly.
export default function NewLoanPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-xl">
      <Link href="/money" className="flex h-10 w-fit items-center font-extrabold text-sea-dark">‹ Money</Link>
      <h1 className="font-display text-3xl font-semibold">Add loan</h1>
      <Suspense fallback={<div className="h-[560px] rounded-[20px] bg-line-soft" />}>
        <Loan />
      </Suspense>
    </div>
  );
}

async function Loan() {
  await connection();
  const [accounts, people] = await Promise.all([getAccounts(), getPeople()]);
  return (
    <LoanForm
      wallets={accounts.filter((a) => paysInPesos(a))}
      people={people.map((p) => ({ id: p.id, name: p.name }))}
      today={today()}
    />
  );
}

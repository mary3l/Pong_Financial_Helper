"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreditLineForm } from "@/app/(app)/money/credit-line-form";
import { LoanForm } from "@/app/(app)/money/loan/new/loan-form";
import type { Account } from "@/lib/data";
import { ordinal } from "@/components/payday-picker";
import { formatPeso } from "@/lib/money";

const NEXT = "/setup/payday";

/**
 * Step 3 of setup: what you've added so far, and one form at a time to add
 * a BNPL or credit line, or a loan you're already paying. Saving closes the
 * form and the list picks it up.
 */
export function DebtsStep({
  debts,
  wallets,
  today,
}: {
  /** Credit lines and loans already added. */
  debts: Account[];
  /** Wallets a loan's payments can come from. */
  wallets: Account[];
  today: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState<"credit" | "loan" | null>(null);

  function done() {
    setAdding(null);
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {debts.length > 0 && (
        <section
          aria-label="What you owe so far"
          className="flex flex-col rounded-3xl bg-card px-5 py-2"
        >
          {debts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between border-b border-line-soft py-3 last:border-0"
            >
              <div className="flex flex-col">
                <span className="font-bold">{a.name}</span>
                <span className="text-sm text-muted">
                  {a.type === "loan" ? "Loan" : "BNPL / credit line"}
                  {a.dueDay ? ` · due ${ordinal(a.dueDay)}` : ""}
                </span>
              </div>
              <span className="font-display text-lg font-semibold">
                {formatPeso(Math.max(0, -a.balance))}
              </span>
            </div>
          ))}
        </section>
      )}

      {adding === "credit" ? (
        <div className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
          <h2 className="font-display text-xl font-semibold">BNPL or credit line</h2>
          {/* Its own Cancel calls onDone too. */}
          <CreditLineForm onDone={done} />
        </div>
      ) : adding === "loan" ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold">Loan</h2>
          <LoanForm
            wallets={wallets}
            people={[]}
            today={today}
            initialMode="running"
            onDone={done}
          />
          <button
            type="button"
            onClick={() => setAdding(null)}
            className="h-11 font-extrabold text-sea-dark"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setAdding("credit")}
            className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
          >
            + BNPL or credit line
          </button>
          <button
            type="button"
            onClick={() => setAdding("loan")}
            className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
          >
            + Loan
          </button>
          <p className="text-sm leading-relaxed text-muted">
            SPayLater, Atome, MariBank, GoTyme · SLoan, MariLoan
          </p>
        </div>
      )}

      {adding === null && (
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <Link
            href={NEXT}
            className="flex h-14 items-center justify-center rounded-[20px] bg-sun text-lg font-extrabold text-ink"
          >
            Next
          </Link>
          {debts.length === 0 && (
            <Link
              href={NEXT}
              className="flex h-11 items-center justify-center font-extrabold text-sea-dark"
            >
              Skip for now
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

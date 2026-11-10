"use client";

import { useState, useTransition } from "react";
import { updateLoan } from "@/app/credit-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import type { Account, InstallmentPlan } from "@/lib/data";
import { formatShortDay, isValidDate } from "@/lib/dates";
import { editLoan } from "@/lib/loan-edit";
import { formatPeso, parseAmount, parseExactAmount, roundCents } from "@/lib/money";

/**
 * Edits a saved loan: its name, terms, next due date and wallet. Payments
 * already made stay; the preview shows the unpaid ones as they'll be saved.
 */
export function LoanEditForm({
  account,
  plan,
  wallets,
  today,
  paidBy = null,
  onDone,
}: {
  account: Account;
  /** Null when its plan was removed: then only the name can change. */
  plan: InstallmentPlan | null;
  wallets: Account[];
  today: string;
  /** Someone else pays it (a loan in your name): their name. What they owe you follows the new terms. */
  paidBy?: string | null;
  onDone: () => void;
}) {
  const theirs = Boolean(plan?.personId);
  const firstUnpaid = plan?.payments.find((p) => !p.transactionId);
  const [name, setName] = useState(account.name);
  // Amount fields take centavos, so a saved 3100.725 shows as 3100.73.
  const cents = (n: number | undefined) => (n === undefined ? "" : String(roundCents(n)));
  const [received, setReceived] = useState(cents(plan?.principal));
  const [monthly, setMonthly] = useState(cents(firstUnpaid?.amount ?? plan?.payments[0]?.amount));
  const [months, setMonths] = useState(String(plan?.months ?? ""));
  const [nextDue, setNextDue] = useState(firstUnpaid?.dueOn ?? today);
  const [payFrom, setPayFrom] = useState(plan?.payFromAccountId ?? wallets[0]?.id ?? "");
  // Added as just received, but the money was already in the wallet or spent: take the transfer back out.
  const [alreadyHad, setAlreadyHad] = useState(false);
  // Already paying when added (no transfer in): payments before the first saved one were made outside the app.
  const running = Boolean(plan && (theirs || !plan.sourceTxnId || alreadyHad));
  const savedFirstSeq = plan?.payments.length ? Math.min(...plan.payments.map((p) => p.seq)) : 1;
  const [paidBefore, setPaidBefore] = useState(savedFirstSeq - 1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const terms = {
    received: parseAmount(received),
    monthly: parseExactAmount(monthly),
    months: Number(months),
    nextDue,
    ...(running ? { paidBefore } : {}),
    ...(alreadyHad ? { alreadyHad } : {}),
  };
  const paidHere = plan?.payments.filter((p) => p.transactionId).map((p) => p.seq) ?? [];
  const maxBefore = Math.min(
    (Number.isInteger(terms.months) && terms.months > 0 ? terms.months : 1) - 1,
    paidHere.length ? Math.min(...paidHere) - 1 : Infinity,
  );
  const termsOk =
    terms.received > 0 && terms.monthly > 0 && Number.isInteger(terms.months) && terms.months >= 1 && terms.months <= 60 && isValidDate(nextDue);
  const preview =
    plan && termsOk
      ? editLoan(
          plan.payments.map((p) => ({ seq: p.seq, principalPart: p.principalPart, feePart: p.feePart, paid: Boolean(p.transactionId) })),
          terms,
        )
      : null;
  const paidCount = plan?.payments.filter((p) => p.transactionId).length ?? 0;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (plan && !termsOk) {
      setError(
        !(terms.received > 0)
          ? "Check the loan amount: a number with up to 2 decimals."
          : !(terms.monthly > 0)
            ? "Check the monthly payment: a number with up to 4 decimals."
            : !(Number.isInteger(terms.months) && terms.months >= 1 && terms.months <= 60)
              ? "Months should be a whole number from 1 to 60."
              : "Pick when the next payment is due.",
      );
      return;
    }
    startTransition(async () => {
      const result = await updateLoan(account.id, {
        name,
        // Without a plan the server only renames it, so the terms are placeholders.
        ...(plan ? terms : { received: 1, monthly: 1, months: 1, nextDue: today }),
        payFromAccountId: theirs ? null : payFrom || null,
      });
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  const money = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <div className="relative">
        <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
        <AmountInput id={id} value={value} onChange={set} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
      </div>
    </div>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="edit-loan-name" className="text-sm font-bold">Name</label>
        <input id="edit-loan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={FIELD_CLASS} />
      </div>
      {plan && (
        <>
          {/* Two across only with room: on a phone each field gets the full width. */}
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {money("edit-loan-received", plan.sourceTxnId && !alreadyHad && !theirs ? "Amount received" : "Loan amount", received, setReceived)}
            {money("edit-loan-monthly", "Monthly payment", monthly, setMonthly)}
            <div className="flex flex-col gap-1">
              <label htmlFor="edit-loan-months" className="text-sm font-bold">Months</label>
              <input id="edit-loan-months" value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" className={FIELD_CLASS} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="edit-loan-next" className="text-sm font-bold">Next payment due</label>
              <input id="edit-loan-next" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className={FIELD_CLASS} />
            </div>
            {running && (
              <div className="flex flex-col gap-1">
                <span id="edit-loan-before-label" className="text-sm font-bold">Paid before adding here</span>
                <div role="group" aria-labelledby="edit-loan-before-label" className="flex h-12 items-center justify-between rounded-[14px] border-2 border-line px-1">
                  <button
                    type="button"
                    aria-label="One fewer payment made before"
                    disabled={paidBefore <= 0}
                    onClick={() => setPaidBefore(Math.max(0, paidBefore - 1))}
                    className="h-9 w-9 rounded-[10px] text-xl font-extrabold text-sea-dark hover:bg-sea-tint disabled:opacity-30"
                  >
                    &minus;
                  </button>
                  <span aria-live="polite" className="font-extrabold">
                    {paidBefore}
                    {terms.months > 0 && <span className="font-bold text-muted"> of {terms.months}</span>}
                  </span>
                  <button
                    type="button"
                    aria-label="One more payment made before"
                    disabled={paidBefore >= maxBefore}
                    onClick={() => setPaidBefore(paidBefore + 1)}
                    className="h-9 w-9 rounded-[10px] text-xl font-extrabold text-sea-dark hover:bg-sea-tint disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
            )}
            {/* Someone else's loan never comes out of your wallets. */}
            {!theirs && (
            <div className={`${running ? "" : "min-[420px]:col-span-2 "}flex flex-col gap-1`}>
              <label htmlFor="edit-loan-from" className="text-sm font-bold">Pay from</label>
              <select id="edit-loan-from" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className={FIELD_CLASS}>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
                {!wallets.length && <option value="">Any wallet</option>}
              </select>
            </div>
            )}
          </div>
          {preview && "error" in preview && (
            <p className="text-sm font-bold text-coral-text">{preview.error}</p>
          )}
          {preview && !("error" in preview) && (
            <p className="rounded-2xl bg-card px-3.5 py-2.5 text-[13px] leading-snug">
              {preview.rows.length ? (
                <>
                  {preview.rows.length} payment{preview.rows.length === 1 ? "" : "s"} left
                  {preview.rows[0] &&
                    ` from ${formatShortDay(preview.rows[0].dueOn, today)} (${preview.rows[0].seq} of ${terms.months})`}{" "}
                  · {formatPeso(preview.owedNow)} principal still owed.
                  {running &&
                    paidBefore > 0 &&
                    (theirs
                      ? ` The ${paidBefore} made before adding here don't count in what ${paidBy ?? "they"} owe${paidBy ? "s" : ""} you.`
                      : ` The ${paidBefore} made before adding here aren't logged as spending.`)}
                </>
              ) : (
                "Every payment is made."
              )}
              {paidCount > 0 &&
                ` The ${paidCount} payment${paidCount === 1 ? "" : "s"} ${theirs ? `${paidBy ?? "they"} made` : "you made"} stay as they are.`}
              {theirs
                ? ` What ${paidBy ?? "they"} owe${paidBy ? "s" : ""} you for this loan becomes ${formatPeso(preview.owedNow)}, plus the interest in the payments left. None of it is your expense.`
                : plan.sourceTxnId && !alreadyHad
                  ? " A new amount received also changes the transfer that brought it in."
                  : ""}
            </p>
          )}
          {plan.sourceTxnId && !theirs && (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-sun-tint px-3.5 py-3 text-sm leading-snug">
              <input
                type="checkbox"
                checked={alreadyHad}
                onChange={(e) => {
                  setAlreadyHad(e.target.checked);
                  if (!e.target.checked) setPaidBefore(savedFirstSeq - 1);
                }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-sea"
              />
              <span>
                <strong>Don&apos;t add this money to a wallet.</strong> For money already spent (even if you don&apos;t
                remember where), or already counted in the wallet&apos;s balance. Takes the{" "}
                {formatPeso(roundCents(plan.principal))} back out of the wallet it went into. What you owe stays the
                same.
              </span>
            </label>
          )}
        </>
      )}
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Updating…" : "Update loan"}
        </button>
        <button type="button" onClick={onDone} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
          Cancel
        </button>
      </div>
    </form>
  );
}

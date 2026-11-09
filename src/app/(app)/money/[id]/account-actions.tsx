"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addUpcomingPayments, deleteLoanForGood, payInstallments, removePlan } from "@/app/credit-actions";
import { assignPlanToPerson, theyPaidInstallments } from "@/app/people-actions";
import { removeWallet, restoreWallet } from "@/app/wallet-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import type { Account, InstallmentPlan } from "@/lib/data";
import { formatShortDay, isValidDate } from "@/lib/dates";
import { monthlyDates } from "@/lib/forecast";
import { formatPeso, parseAmount, roundCents } from "@/lib/money";
import { CreditLineForm } from "../credit-line-form";
import { LoanEditForm } from "./loan-edit-form";

/** Pays every installment due on the next bill date. */
export function PayBillButton({ ids, total }: { ids: string[]; total: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await payInstallments(ids);
            setError(result.error ?? null);
          })
        }
        className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60"
      >
        {pending ? "Paying…" : `Pay bill · ${formatPeso(total)}`}
      </button>
      <p role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</p>
    </div>
  );
}

/**
 * Someone else's installments on this credit line: they paid. Their money
 * goes straight to the bill, so your wallets don't move.
 */
export function TheyPaidButton({ ids, label }: { ids: string[]; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await theyPaidInstallments(ids);
            setError(result.error ?? null);
          })
        }
        className="h-10 shrink-0 rounded-full border-2 border-sea px-3.5 text-[13px] font-extrabold text-sea-dark disabled:opacity-60"
      >
        {pending ? "Saving…" : label}
      </button>
      <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
    </span>
  );
}

/**
 * Someone else pays this plan: what's left becomes pautang, and its
 * payments leave your forecast and Safe to spend.
 */
export function AssignPlanButton({
  planId,
  name,
  left,
  interest,
  loan,
  people,
}: {
  planId: string;
  name: string;
  /** Principal still unpaid: what they'll owe you. */
  left: number;
  /** Interest or fees in the payments left: theirs to pay too. */
  interest: number;
  /** A loan; `movesMoney` when its money came into a wallet and nothing's paid yet. */
  loan: { movesMoney: boolean } | null;
  people: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-fit text-[13px] font-extrabold text-sea-dark underline">
        Someone else pays this
      </button>
    );
  }
  const search = typed.trim().toLowerCase();
  const matches = search ? people.filter((p) => p.name.toLowerCase().includes(search)) : people;
  const exact = people.find((p) => p.name.toLowerCase() === search);
  const who = personId ? people.find((p) => p.id === personId)?.name : exact?.name ?? typed.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const target = personId ? { personId } : exact ? { personId: exact.id } : { name: typed };
        if (!personId && !search) {
          setError("Who pays it? Pick someone or type a name.");
          return;
        }
        startTransition(async () => {
          const result = await assignPlanToPerson(planId, target);
          if (result.error) setError(result.error);
          else setOpen(false);
        });
      }}
      className="flex flex-col gap-2 rounded-[16px] bg-mint p-3"
    >
      <label htmlFor={`assign-${planId}`} className="text-sm font-bold">{loan ? `Who is this ${name} loan for?` : `Who uses your account for ${name}?`}</label>
      <input
        id={`assign-${planId}`}
        value={personId ? (people.find((p) => p.id === personId)?.name ?? "") : typed}
        onChange={(e) => {
          setPersonId(null);
          setTyped(e.target.value);
        }}
        maxLength={60}
        placeholder="Search or add a person"
        className={FIELD_CLASS}
      />
      {matches.length > 0 && (
        <div role="group" aria-label="People" className="flex flex-wrap gap-2">
          {matches.slice(0, 8).map((p) => (
            <ChoiceChip
              key={p.id}
              selected={personId === p.id}
              onClick={() => {
                setPersonId(p.id);
                setTyped("");
              }}
            >
              {p.name}
            </ChoiceChip>
          ))}
        </div>
      )}
      <p className="text-xs leading-snug text-muted">
        {who || "They"} will owe you {formatPeso(left)}
        {interest > 0 && <>, plus the {formatPeso(interest)} {loan ? "interest" : "fees"} in the payments left</>}. Its
        payments leave your forecast and Safe to spend, and <strong>They paid</strong> sends their money straight to{" "}
        {loan ? name : "the bill"}, so none of it is your expense. Payments already made stay as they are.
        {loan?.movesMoney && " The loan money that landed in your wallet changes to having gone to them."}
      </p>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-4 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : `${who || "They"} pays it`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Removes a plan entered by mistake or paid off early. Asks once first. */
export function RemovePlanButton({ id, name }: { id: string; name: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        aria-label={confirm ? `Confirm remove ${name}` : `Remove ${name}`}
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            return;
          }
          startTransition(async () => {
            const result = await removePlan(id);
            if (result.error) setError(result.error);
          });
        }}
        onBlur={() => setConfirm(false)}
        className={`h-9 rounded-full px-3 text-xs font-extrabold disabled:opacity-60 ${
          confirm ? "bg-coral text-white" : "text-coral-text hover:bg-coral-tint"
        }`}
      >
        {pending ? "Removing…" : confirm ? "Tap to remove" : "Remove"}
      </button>
      <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
    </span>
  );
}

/** Edit a credit line or loan, or archive / restore the account. */
export function AccountActions({
  account,
  loan,
  startEditing = false,
}: {
  account: Account;
  /** Loans: the plan and wallets the edit form needs. */
  loan?: { plan: InstallmentPlan | null; wallets: Account[]; today: string };
  startEditing?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(startEditing);
  const [confirm, setConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = account.type === "credit_line" || (account.type === "loan" && loan);

  if (editing && editable) {
    return (
      <div id="edit" className="scroll-mt-4 rounded-[20px] bg-card p-4">
        {loan ? (
          <LoanEditForm account={account} {...loan} onDone={() => setEditing(false)} />
        ) : (
          <CreditLineForm account={account} onDone={() => setEditing(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex flex-wrap gap-2">
        {editable && (
          <button type="button" onClick={() => setEditing(true)} className="h-11 rounded-[14px] bg-card px-4 font-extrabold text-ink hover:bg-sea-tint">
            Edit {account.name}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onBlur={() => setConfirm(false)}
          onClick={() => {
            if (!account.archived && !confirm) {
              setConfirm(true);
              return;
            }
            startTransition(async () => {
              const result = account.archived ? await restoreWallet(account.id) : await removeWallet(account.id);
              if (result.error) setError(result.error);
              else if (!account.archived && !result.archived) router.push("/money");
            });
          }}
          className={`h-11 rounded-[14px] px-4 font-extrabold disabled:opacity-60 ${
            account.archived ? "bg-card text-ink" : confirm ? "bg-coral text-white" : "text-coral-text hover:bg-coral-tint"
          }`}
        >
          {account.archived ? "Restore" : confirm ? "Tap again to remove" : "Remove"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Removing one with history archives it instead, so your past transactions stay right.
      </p>
      {account.type === "loan" && (
        <div className="mt-2 flex flex-col gap-2 rounded-[20px] bg-coral-tint p-4">
          <p className="text-sm leading-snug">
            <strong>Added by mistake, or twice?</strong> Delete for good removes {account.name} and everything it
            logged: the money it put into a wallet, its payments and their interest. Wallet balances go back to what
            they&apos;d be without it. This can&apos;t be undone.
          </p>
          <button
            type="button"
            disabled={pending}
            onBlur={() => setConfirmDelete(false)}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              startTransition(async () => {
                const result = await deleteLoanForGood(account.id);
                if (result.error) setError(result.error);
                else router.push("/money");
              });
            }}
            className={`h-11 w-fit rounded-[14px] px-4 font-extrabold disabled:opacity-60 ${
              confirmDelete ? "bg-coral text-white" : "bg-card text-coral-text"
            }`}
          >
            {pending && confirmDelete ? "Deleting…" : confirmDelete ? "Tap again to delete for good" : "Delete for good"}
          </button>
        </div>
      )}
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
    </div>
  );
}

const MONTH_CHOICES = [2, 3, 4, 5, 6, 9, 12, 18, 24, 36];

/**
 * + Upcoming payment on SPayLater, Atome or a bank's credit line: a bill
 * you already expect, or an installment that's already running ("4 of 6"),
 * like ones from before you used Pong or what the provider's app shows.
 */
export function UpcomingPayments({
  account,
  unscheduled,
  defaultDue,
  today,
  startOpen,
}: {
  account: Account;
  /** What you owe that has no payment dates yet. */
  unscheduled: number;
  defaultDue: string;
  today: string;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [installment, setInstallment] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [firstDue, setFirstDue] = useState(defaultDue);
  const [months, setMonths] = useState(6);
  const [alreadyPaid, setAlreadyPaid] = useState(0);
  const [owedChoice, setOwedChoice] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = installment ? months : 1;
  const paid = installment ? Math.min(alreadyPaid, total - 1) : 0;
  const left = total - paid;
  const each = amount.trim() ? parseAmount(amount) : NaN;
  const feeEach = installment && fee.trim() ? parseAmount(fee) : 0;
  const valid = !Number.isNaN(each) && each > 0 && !Number.isNaN(feeEach) && feeEach < each;
  const toPay = valid ? roundCents(each * left) : 0;
  const interest = valid ? roundCents(feeEach * left) : 0;
  // Interest is counted as you pay, so only the principal left goes into what you owe.
  const owedLeft = roundCents(toPay - interest);
  // Until you choose: add it to what you owe only if it doesn't fit in what's unscheduled.
  const addToOwed = owedChoice ?? owedLeft > unscheduled;
  const dates = isValidDate(firstDue) ? monthlyDates(firstDue, left) : [];

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (Number.isNaN(each) || each <= 0) {
      setError("Enter how much you'll pay.");
      return;
    }
    if (Number.isNaN(feeEach) || feeEach >= each) {
      setError("The interest or fee has to be less than the payment.");
      return;
    }
    startTransition(async () => {
      const result = await addUpcomingPayments(account.id, {
        name,
        amount: each,
        fee: feeEach,
        firstDue,
        months: total,
        alreadyPaid: paid,
        addToOwed,
      });
      if (result.error) setError(result.error);
      else {
        setOpen(false);
        setName("");
        setAmount("");
        setFee("");
        setAlreadyPaid(0);
        setOwedChoice(null);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
      >
        + Upcoming payment or installment
      </button>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-xl font-semibold">Upcoming payment</h2>
        <p className="text-[13px] text-muted">
          A bill or an installment on {account.name}, like one its app already shows. It goes into
          Coming up, your forecast and Safe to spend.
        </p>
      </div>
      <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
        {[
          { value: false, label: "One bill" },
          { value: true, label: "Installment" },
        ].map((k) => (
          <ChoiceChip
            key={k.label}
            selected={installment === k.value}
            onClick={() => setInstallment(k.value)}
            className={installment === k.value ? "" : "bg-mint"}
          >
            {k.label}
          </ChoiceChip>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="upcoming-amount" className="text-sm font-bold">{installment ? "Monthly payment" : "Amount"}</label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
            <AmountInput
              id="upcoming-amount"
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              required
              autoFocus
              className={`${FIELD_CLASS} w-full pl-8 text-right`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="upcoming-due" className="text-sm font-bold">{installment ? "Next payment due" : "Due"}</label>
          <input
            id="upcoming-due"
            type="date"
            value={firstDue}
            min={today}
            onChange={(e) => setFirstDue(e.target.value)}
            required
            className={FIELD_CLASS}
          />
        </div>
        {installment && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="upcoming-months" className="text-sm font-bold">Months in all</label>
              <select id="upcoming-months" value={months} onChange={(e) => setMonths(Number(e.target.value))} className={FIELD_CLASS}>
                {MONTH_CHOICES.map((m) => (
                  <option key={m} value={m}>{m} months</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="upcoming-paid" className="text-sm font-bold">Payments already made</label>
              <select id="upcoming-paid" value={paid} onChange={(e) => setAlreadyPaid(Number(e.target.value))} className={FIELD_CLASS}>
                {Array.from({ length: total }, (_, i) => i).map((n) => (
                  <option key={n} value={n}>{n === 0 ? "None yet" : `${n} of ${total}`}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="upcoming-fee" className="text-sm font-bold">
                Interest or fee in each <span className="font-semibold text-muted">(optional)</span>
              </label>
              <div className="relative">
                <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
                <AmountInput
                  id="upcoming-fee"
                  value={fee}
                  onChange={setFee}
                  placeholder="0.00"
                  aria-describedby="upcoming-fee-hint"
                  className={`${FIELD_CLASS} w-full pl-8 text-right`}
                />
              </div>
              <span id="upcoming-fee-hint" className="text-xs text-muted">
                Only this part counts as spending when you pay. The rest pays down what you owe.
              </span>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="upcoming-name" className="text-sm font-bold">
            For <span className="font-semibold text-muted">(optional)</span>
          </label>
          <input
            id="upcoming-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder={installment ? "e.g. Phone" : "e.g. Shopee order"}
            className={FIELD_CLASS}
          />
        </div>
      </div>
      {valid && dates.length > 0 && (
        <p className="text-[13px] text-muted">
          {formatPeso(each)} on {dates.slice(0, 3).map((d) => formatShortDay(d, today)).join(", ")}
          {dates.length > 3 && `, … ${formatShortDay(dates.at(-1)!, today)}`}
          {installment && ` (payments ${paid + 1} to ${total} of ${total})`}
          {left > 1 && ` · ${formatPeso(toPay)} left to pay`}
          {interest > 0 && `, ${formatPeso(interest)} of it interest or fees`}
        </p>
      )}
      <label className="flex items-start gap-3 rounded-[14px] bg-mint px-3 py-2.5">
        <input
          type="checkbox"
          checked={addToOwed}
          onChange={(e) => setOwedChoice(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-sea"
        />
        <span className="flex flex-col text-[13px]">
          <span className="font-bold">Add {owedLeft > 0 ? formatPeso(owedLeft) : "it"} to what I owe on {account.name}</span>
          <span className="text-muted">
            Leave this off if it&apos;s already in what you owe
            {unscheduled > 0 ? ` (${formatPeso(unscheduled)} of that has no payment dates yet)` : ""}. Turn it on
            for a purchase you haven&apos;t logged.
          </span>
        </span>
      </label>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : left > 1 ? `Add ${left} payments` : "Add payment"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-mint">
          Cancel
        </button>
      </div>
    </form>
  );
}

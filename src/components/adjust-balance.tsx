"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adjustBalance, deleteTransaction, updateAdjustment } from "@/app/transaction-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { FormDialog } from "@/components/form-dialog";
import { PlusIcon } from "@/components/icons";
import type { Account, Transaction } from "@/lib/data";
import { isValidDate } from "@/lib/dates";
import { formatMoney, parseAmount, roundCents } from "@/lib/money";

/**
 * Under a wallet's balance: + Add opens Add with this wallet picked, and
 * Adjust balance sets what's really in it when it's drifted from the app.
 */
export function WalletButtons({ account, today }: { account: Account; today: string }) {
  const [adjusting, setAdjusting] = useState(false);
  if (account.archived) return null;
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <Link
          href={`/add?account=${account.id}`}
          className="flex h-12 items-center justify-center gap-1.5 rounded-[18px] bg-sun font-extrabold text-ink"
        >
          <PlusIcon size={18} />
          Add transaction
        </Link>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setAdjusting(true)}
          className="h-12 rounded-[18px] bg-card font-extrabold text-ink hover:bg-sea-tint"
        >
          Adjust balance
        </button>
      </div>
      {adjusting && (
        <FormDialog title="Adjust balance" onClose={() => setAdjusting(false)}>
          <AdjustBalanceForm account={account} today={today} onDone={() => setAdjusting(false)} />
        </FormDialog>
      )}
    </>
  );
}

function AdjustBalanceForm({ account, today, onDone }: { account: Account; today: string; onDone: () => void }) {
  const [actual, setActual] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const money = (v: number) => formatMoney(v, account.currency);
  const value = actual.trim() ? parseAmount(actual) : NaN;
  const change = Number.isNaN(value) ? null : roundCents(value - account.balance);

  function save() {
    if (change === null) {
      setError("Type what's in it now.");
      return;
    }
    if (change === 0) {
      setError("That's already what's in it.");
      return;
    }
    if (!isValidDate(date)) {
      setError("Pick a date.");
      return;
    }
    startTransition(async () => {
      const result = await adjustBalance(account.id, value, { occurredOn: date, note });
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <form
      aria-label="Adjust balance"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="adjust-actual" className="text-sm font-extrabold">
          What&apos;s really in {account.name} now?
        </label>
        <AmountInput
          id="adjust-actual"
          label={`In ${account.name} now`}
          value={actual}
          onChange={(v) => {
            setActual(v);
            setError(null);
          }}
          placeholder={money(account.balance).replace(/[₱$]/, "")}
          autoFocus
          className={`${FIELD_CLASS} w-full`}
        />
      </div>
      <p aria-live="polite" className="text-sm text-muted">
        {change === null || change === 0 ? (
          <>Pong has {money(account.balance)}. Count what&apos;s really there and type it in.</>
        ) : (
          <>
            That&apos;s <strong className={change > 0 ? "text-sea-dark" : "text-coral-text"}>{money(Math.abs(change))} {change > 0 ? "more" : "less"}</strong>{" "}
            than the {money(account.balance)} Pong has. It&apos;s logged as a balance adjustment, not as spending or income.
          </>
        )}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor="adjust-date" className="text-[13px] font-extrabold">Date</label>
          <input id="adjust-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="adjust-note" className="text-[13px] font-extrabold">Note</label>
          <input
            id="adjust-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
            placeholder="optional"
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex gap-2.5">
        <button type="button" onClick={onDone} className="h-12 flex-1 rounded-[18px] bg-card font-extrabold">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="h-12 flex-[2] rounded-[18px] bg-sun font-extrabold text-ink disabled:opacity-60">
          {pending
            ? "Saving…"
            : change
              ? `Adjust ${change > 0 ? "up" : "down"} ${money(Math.abs(change))}`
              : "Adjust"}
        </button>
      </div>
    </form>
  );
}

/** Edit or delete a balance adjustment from Activity or a wallet. */
export function AdjustmentEditor({
  transaction,
  walletName,
  closeHref,
  today,
}: {
  transaction: Transaction;
  walletName: string;
  closeHref: string;
  today: string;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"up" | "down">(transaction.type === "income" ? "up" : "down");
  const [amount, setAmount] = useState(String(transaction.amount));
  const [date, setDate] = useState(transaction.occurredOn);
  const [note, setNote] = useState(transaction.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const value = parseAmount(amount);

  function save() {
    if (Number.isNaN(value) || value <= 0) {
      setError("Enter an amount above ₱0.");
      return;
    }
    startTransition(async () => {
      const result = await updateAdjustment(transaction.id, direction === "up" ? value : -value, { occurredOn: date, note });
      if (result.error) setError(result.error);
      else router.push(closeHref);
    });
  }

  function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteTransaction(transaction.id);
      if (result.error) setError(result.error);
      else router.push(closeHref);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-4 lg:max-w-xl"
    >
      <div className="flex flex-col gap-0.5">
        <h1 className="font-display text-3xl font-semibold">Balance adjustment</h1>
        <span className="text-[15px] text-muted">
          {walletName} · not spending or income, it only changes the balance
        </span>
      </div>
      <div role="group" aria-label="Direction" className="flex gap-2">
        <ChoiceChip selected={direction === "up"} onClick={() => setDirection("up")}>Adjusted up</ChoiceChip>
        <ChoiceChip selected={direction === "down"} onClick={() => setDirection("down")}>Adjusted down</ChoiceChip>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="adjustment-amount" className="text-sm font-extrabold">By how much</label>
        <AmountInput
          id="adjustment-amount"
          label="Adjustment"
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setError(null);
          }}
          className={`${FIELD_CLASS} w-full`}
        />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor="adjustment-date" className="text-[13px] font-extrabold">Date</label>
          <input id="adjustment-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="adjustment-note" className="text-[13px] font-extrabold">Note</label>
          <input
            id="adjustment-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
            placeholder="optional"
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={remove}
          onBlur={() => setConfirmDelete(false)}
          disabled={pending}
          className={`h-14 flex-1 rounded-[18px] font-extrabold ${confirmDelete ? "bg-coral text-white" : "bg-card text-coral-text"}`}
        >
          {confirmDelete ? "Tap again to delete" : "Delete"}
        </button>
        <button type="submit" disabled={pending} className="h-14 flex-[2] rounded-[18px] bg-sun text-[17px] font-extrabold text-ink disabled:opacity-60">
          {pending ? "Updating…" : "Update adjustment"}
        </button>
      </div>
      <Link href={closeHref} className="w-fit font-extrabold text-sea-dark">Cancel</Link>
    </form>
  );
}

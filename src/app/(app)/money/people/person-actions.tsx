"use client";

import { useState, useTransition } from "react";
import { forgive, recordPayment, renamePerson, settlePerson } from "@/app/people-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import type { Account } from "@/lib/data";
import { formatPeso, parseAmount } from "@/lib/money";

/** Pays back (or collects) the whole balance from your usual wallet. */
export function SettleButton({ personId, label }: { personId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await settlePerson(personId);
            setError(result.error ?? null);
          })
        }
        className="h-10 rounded-full bg-sea px-3.5 text-[13px] font-extrabold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : label}
      </button>
      <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
    </span>
  );
}

/** Record payment: pick the wallet it landed in (or left from). Partial amounts OK. */
export function PaymentForm({
  personId,
  balance,
  wallets,
  today,
}: {
  personId: string;
  balance: number;
  wallets: Account[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.abs(balance)));
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const theyPay = balance > 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="h-12 rounded-[16px] bg-sun font-extrabold text-ink">
        {theyPay ? "Record payment" : "Pay back"}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = parseAmount(amount);
        if (!(value > 0)) {
          setError("Enter an amount above ₱0.");
          return;
        }
        startTransition(async () => {
          const result = await recordPayment(personId, value, walletId, date);
          if (result.error) setError(result.error);
          else setOpen(false);
        });
      }}
      className="col-span-2 flex flex-col gap-3 rounded-[20px] bg-card p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-amount" className="text-sm font-bold">Amount</label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
            <AmountInput id="pay-amount" value={amount} onChange={setAmount} className={`${FIELD_CLASS} w-full pl-8 text-right`} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-wallet" className="text-sm font-bold">{theyPay ? "Landed in" : "Paid from"}</label>
          <select id="pay-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)} className={FIELD_CLASS}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <label htmlFor="pay-date" className="text-sm font-bold">Date</label>
          <input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD_CLASS} />
        </div>
      </div>
      <p className="text-xs text-muted">
        A transfer, not {theyPay ? "income" : "spending"}: it was your money all along.
      </p>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : `${theyPay ? "Record" : "Pay back"}${parseAmount(amount) > 0 ? ` ${formatPeso(parseAmount(amount))}` : ""}${theyPay ? " payment" : ""}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-mint">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Forgive remaining balance: turns what's left into an expense (Gifts). */
export function ForgiveButton({ personId, balance }: { personId: string; balance: number }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onBlur={() => setConfirm(false)}
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            return;
          }
          startTransition(async () => {
            const result = await forgive(personId);
            setError(result.error ?? null);
            setConfirm(false);
          });
        }}
        className={`h-11 rounded-[14px] px-4 font-extrabold ${confirm ? "bg-coral text-white" : "text-ink underline"}`}
      >
        {pending ? "Saving…" : confirm ? `Tap again to forgive ${formatPeso(Math.abs(balance))}` : balance > 0 ? "Forgive remaining balance" : "They forgave it"}
      </button>
      <span className="text-xs text-muted">
        {balance > 0 ? "Turns what's left into an expense (Gifts)" : "Turns what's left into income (Gift)"}
      </span>
      <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
    </div>
  );
}

/** Rename someone or save their number for reminders. */
export function EditPerson({ personId, name, contact }: { personId: string; name: string; contact: string | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [phone, setPhone] = useState(contact ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="h-10 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-card">
        Edit
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await renamePerson(personId, value, phone);
          if (result.error) setError(result.error);
          else setOpen(false);
        });
      }}
      className="flex w-full flex-col gap-2 rounded-[20px] bg-card p-4"
    >
      <label htmlFor="person-name" className="text-sm font-bold">Name</label>
      <input id="person-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} className={FIELD_CLASS} />
      <label htmlFor="person-contact" className="text-sm font-bold">
        Number or handle <span className="font-semibold text-muted">(optional)</span>
      </label>
      <input id="person-contact" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={100} className={FIELD_CLASS} />
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Updating…" : "Update details"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-mint">
          Cancel
        </button>
      </div>
    </form>
  );
}

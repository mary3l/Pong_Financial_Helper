"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { borrowWasPaidForMe, deletePerson, deletePersonEntry, forgive, recordPayment, renamePerson, restorePerson, settlePerson } from "@/app/people-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { FormDialog } from "@/components/form-dialog";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
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
export function EditPerson({
  personId,
  name,
  contact,
  loans = [],
}: {
  personId: string;
  name: string;
  contact: string | null;
  /** Loans in your name they pay: their amount, payments and interest are edited on the loan. */
  loans?: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [phone, setPhone] = useState(contact ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValue(name);
          setPhone(contact ?? "");
          setError(null);
          setOpen(true);
        }}
        className="h-10 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-card"
      >
        Edit
      </button>
      {open && (
        <FormDialog title="Update details" onClose={() => setOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await renamePerson(personId, value, phone);
                if (result.error) setError(result.error);
                else setOpen(false);
              });
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="person-name" className="text-sm font-bold">Name</label>
            <input id="person-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} className={FIELD_CLASS} />
            <label htmlFor="person-contact" className="text-sm font-bold">
              Number or handle <span className="font-semibold text-muted">(optional)</span>
            </label>
            <input id="person-contact" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={100} className={FIELD_CLASS} />
            <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending} className="h-12 flex-[2] rounded-[16px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
                {pending ? "Updating…" : "Update details"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="h-12 flex-1 rounded-[16px] bg-card px-4 font-extrabold text-ink">
                Cancel
              </button>
            </div>
          </form>
          {loans.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 rounded-[18px] bg-card p-3.5">
              <p className="text-sm leading-snug">
                <strong>Loan amount, payments or interest?</strong> Those are on the loan, and what {name} owes you
                follows them.
              </p>
              {loans.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="flex h-11 items-center justify-center rounded-[14px] border-2 border-sea font-extrabold text-sea-dark"
                >
                  Edit {l.label}
                </Link>
              ))}
            </div>
          )}
        </FormDialog>
      )}
    </>
  );
}

/**
 * Delete someone. With nothing logged with them, they just go. With history,
 * a dialog explains the two ways: archive (hidden, every record kept) or
 * delete for good (every record with them goes too). Not for good while they
 * pay a loan or credit line in your name.
 */
export function DeletePerson({
  personId,
  name,
  records,
  balance,
  inYourName,
}: {
  personId: string;
  name: string;
  /** How many records they have (lent, borrowed, payments, split shares). */
  records: number;
  balance: number;
  /** Loans and credit line purchases in your name they pay, by name. */
  inYourName: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(how: "remove" | "forever") {
    startTransition(async () => {
      const result = await deletePerson(personId, how);
      if (result.error) setError(result.error);
      else router.push("/money/people");
    });
  }

  if (!records) {
    return (
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("remove")}
          className="h-11 rounded-[14px] px-4 font-extrabold text-coral-text hover:bg-coral-tint disabled:opacity-60"
        >
          {pending ? "Deleting…" : `Delete ${name}`}
        </button>
        <span className="text-xs text-muted">Nothing&apos;s logged with them yet, so nothing else changes.</span>
        <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
      </div>
    );
  }

  const owed = Math.abs(balance);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirm(false);
          setOpen(true);
        }}
        className="mx-auto h-11 rounded-[14px] px-4 font-extrabold text-coral-text hover:bg-coral-tint"
      >
        Delete {name}
      </button>
      {open && (
        <FormDialog title={`Delete ${name}?`} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3">
            <p className="text-[15px] leading-snug">
              {name} has {records === 1 ? "1 record" : `${records} records`} in your history.
              {balance !== 0 && (
                <strong>
                  {" "}
                  {balance > 0 ? `They still owe you ${formatPeso(owed)}.` : `You still owe them ${formatPeso(owed)}.`}
                </strong>
              )}
            </p>

            <section className="flex flex-col gap-2 rounded-[20px] bg-card p-4">
              <h3 className="font-extrabold">Archive {name}</h3>
              <p className="text-sm leading-snug text-muted">
                Hides them from Utang &amp; pautang and from Add. Every record stays in Activity, so your wallet
                balances don&apos;t change.
                {balance !== 0 &&
                  ` What's still open stops showing in Utang & pautang, Coming up and the forecast, so record a payment or forgive it first if it's settled.`}{" "}
                Adding someone with the same name brings them back.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => run("remove")}
                className="h-11 w-fit rounded-[14px] bg-sun px-4 font-extrabold text-ink disabled:opacity-60"
              >
                {pending && !confirm ? "Archiving…" : `Archive ${name}`}
              </button>
            </section>

            <section className="flex flex-col gap-2 rounded-[20px] bg-coral-tint p-4">
              <h3 className="font-extrabold">Delete for good</h3>
              {inYourName.length ? (
                <p className="text-sm leading-snug">
                  {name} pays {inYourName.join(", ")} in your name. Remove that from the loan or credit line first,
                  or archive them instead.
                </p>
              ) : (
                <>
                  <p className="text-sm leading-snug">
                    <strong>Added by mistake?</strong> Removes {name} and every record with them: what you lent or
                    borrowed, their payments, and bills they paid for you. Their shares come off each split bill, which
                    keeps your own share. Wallet balances go back to what they&apos;d be without them. This can&apos;t be
                    undone.
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onBlur={() => setConfirm(false)}
                    onClick={() => {
                      if (!confirm) {
                        setConfirm(true);
                        return;
                      }
                      run("forever");
                    }}
                    className={`h-11 w-fit rounded-[14px] px-4 font-extrabold disabled:opacity-60 ${
                      confirm ? "bg-coral text-white" : "bg-card text-coral-text"
                    }`}
                  >
                    {pending && confirm ? "Deleting…" : confirm ? "Tap again to delete for good" : "Delete for good"}
                  </button>
                </>
              )}
            </section>

            <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
          </div>
        </FormDialog>
      )}
    </>
  );
}

/** Archived: brings them back to Utang & pautang. */
export function RestorePerson({ personId }: { personId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await restorePerson(personId);
            setError(result.error ?? null);
          })
        }
        className="h-10 rounded-full bg-card px-3.5 text-sm font-extrabold text-ink disabled:opacity-60"
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
    </span>
  );
}

/**
 * Deletes one record in their history. Tap twice. A split share comes off
 * its bill instead, so the bill's total goes down with it.
 */
export function DeleteEntry({ personId, txnId, what, split }: { personId: string; txnId: string; what: string; split: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex shrink-0 flex-col items-end">
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
            const result = await deletePersonEntry(personId, txnId);
            setError(result.error ?? null);
            setConfirm(false);
          });
        }}
        aria-label={confirm ? undefined : `Delete ${what}`}
        className={`h-9 rounded-full px-3 text-[13px] font-extrabold disabled:opacity-60 ${
          confirm ? "bg-coral text-white" : "text-coral-text hover:bg-coral-tint"
        }`}
      >
        {pending ? "Deleting…" : confirm ? (split ? "Take off bill?" : "Delete?") : "Delete"}
      </button>
      <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
    </span>
  );
}

/**
 * A borrow logged as money into a wallet, when they really paid for
 * something of yours (a flight): turns it into your expense paid by them,
 * so the wallet comes back down and you still owe them the same.
 */
export function PaidForMeButton({
  personId,
  txnId,
  name,
  amount,
  wallet,
  note,
}: {
  personId: string;
  txnId: string;
  name: string;
  amount: number;
  wallet: string;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("other");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="h-9 rounded-full px-3 text-[13px] font-extrabold text-sea-dark hover:bg-mint"
      >
        Not in a wallet?
      </button>
      {open && (
        <FormDialog title="They paid for it directly" onClose={() => setOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await borrowWasPaidForMe(personId, txnId, category);
                if (result.error) setError(result.error);
                else setOpen(false);
              });
            }}
            className="flex flex-col gap-4"
          >
            <p className="text-[15px] leading-relaxed">
              {note ? <strong>{note}</strong> : "This"} is saved as {formatPeso(amount)} you borrowed into{" "}
              <strong>{wallet}</strong>. If {name} paid for something of yours instead and the money never reached
              you, I&apos;ll take it back out of {wallet} and count it as your spending, paid by {name}. You still owe{" "}
              {name} the same.
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor={`paid-for-${txnId}`} className="text-sm font-bold">What it was for</label>
              <select id={`paid-for-${txnId}`} value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD_CLASS}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
            <button type="submit" disabled={pending} className="h-12 rounded-[14px] bg-sun font-extrabold text-ink disabled:opacity-60">
              {pending ? "Saving…" : `Take ${formatPeso(amount)} out of ${wallet}`}
            </button>
          </form>
        </FormDialog>
      )}
    </>
  );
}

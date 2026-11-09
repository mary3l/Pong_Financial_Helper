"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { payInstallments, undoInstallment } from "@/app/credit-actions";
import { settlePerson } from "@/app/people-actions";
import { logPlanned, logRecurring } from "@/app/plan-actions";
import { deleteTransaction } from "@/app/transaction-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { CloseIcon } from "@/components/icons";
import type { Account } from "@/lib/data";
import type { ForecastItem } from "@/lib/forecast";
import { accountTypeLabel, formatPeso, parseAmount, paysInPesos, purposeLabel, roundCents } from "@/lib/money";

/** Opens Add prefilled for an item, linked so saving logs that occurrence. */
export function prefillHref(item: ForecastItem): string {
  const query = new URLSearchParams({
    type: item.flow === "in" ? "income" : "expense",
    note: item.name,
  });
  if (item.amount) query.set("amount", String(item.amount));
  if (item.category) query.set("category", item.category);
  if (item.accountId) query.set("account", item.accountId);
  if (item.kind === "payday" || item.kind === "income" || item.kind === "bill") {
    query.set("link", `${item.id}|${item.dueOn}`);
  }
  return `/add?${query}`;
}

// "Mark paid" for money going out, "Add income" for money coming in. Either
// first asks which wallet (showing each one's balance before and after), then
// logs the real transaction at the scheduled amount; undo deletes it, which
// un-marks the item. An installment logs a transfer plus its fee; utang and
// pautang settle the whole balance (a transfer, never spending).
export function LogButton({ item, accounts }: { item: ForecastItem; accounts: Account[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const paid = Boolean(item.transactionId);
  const incoming = item.flow === "in";
  const label = incoming ? "Add income" : "Mark paid";
  // Scheduled items are in pesos, so dollar wallets aren't offered.
  const wallets = accounts.filter((a) => paysInPesos(a) && !a.archived);

  function run(walletId?: string, amount?: number) {
    setError(null);
    startTransition(async () => {
      const result = await (item.kind === "utang" || item.kind === "pautang"
        ? settlePerson(item.id, walletId)
        : item.kind === "installment"
        ? paid
          ? undoInstallment(item.id)
          : payInstallments([item.id], walletId)
        : paid
          ? deleteTransaction(item.transactionId!)
          : item.kind === "planned"
            ? logPlanned(item.id, walletId)
            : logRecurring(item.id, item.dueOn, walletId, amount ?? item.amount ?? undefined));
      if (result.error) setError(result.error);
      else setPicking(false);
    });
  }

  function click() {
    // Undo is one tap. With no wallet yet, the action says to add one.
    if (paid || !wallets.length) run();
    else {
      setError(null);
      setPicking(true);
    }
  }

  const buttonClass = `flex h-10 min-w-[100px] items-center justify-center rounded-full px-3 text-[13px] font-extrabold disabled:opacity-60 ${
    paid ? "border-2 border-line bg-card text-ink" : incoming ? "bg-sun text-ink" : "bg-sea text-white"
  }`;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {item.amount === null && !paid ? (
        // No amount saved (a payday without net pay): type it in Add.
        <Link href={prefillHref(item)} className={buttonClass}>
          {label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={click}
          disabled={pending}
          aria-label={paid ? `Undo ${item.name}` : `${label}: ${item.name}`}
          className={buttonClass}
        >
          {pending && !picking ? "Saving…" : paid ? `${incoming ? "Received" : "Paid"} · undo` : label}
        </button>
      )}
      {paid && !pending && (
        <Link href={`/activity/${item.transactionId}`} className="text-xs font-extrabold text-sea-dark underline">
          Edit amount
        </Link>
      )}
      {!picking && (
        <p role="alert" className="max-w-40 text-right text-xs font-bold text-coral-text empty:hidden">{error}</p>
      )}
      {picking && item.amount !== null && (
        <WalletPicker
          item={item}
          amount={item.amount}
          wallets={wallets}
          label={label}
          pending={pending}
          error={error}
          onConfirm={run}
          onClose={() => {
            if (!pending) setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/** Which wallet it's paid from (or lands in), with each one's balance now and after. */
function WalletPicker({
  item,
  amount: estimate,
  wallets,
  label,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  item: ForecastItem;
  amount: number;
  wallets: Account[];
  label: string;
  pending: boolean;
  error: string | null;
  onConfirm: (walletId: string, amount: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const incoming = item.flow === "in";
  // An estimate (a payday from the payroll calculator, a bill that varies):
  // type what actually came in or went out. Installments, utang and planned
  // items log their own amounts.
  const editable = item.estimate && (item.kind === "payday" || item.kind === "income" || item.kind === "bill");
  const [typed, setTyped] = useState(() => String(estimate));
  const parsed = editable ? parseAmount(typed) : estimate;
  const valid = Number.isFinite(parsed) && parsed > 0;
  const amount = valid ? parsed : estimate;
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState(
    () => wallets.find((w) => w.id === item.accountId)?.id ?? wallets[0].id,
  );

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
    };
  }, []);

  const heading = incoming ? "Where does it go?" : "Pay it from";

  return (
    <dialog
      ref={ref}
      aria-label={`${heading}: ${item.name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-[28px] bg-mint p-0 text-left text-ink backdrop:bg-scrim/50 lg:m-auto lg:max-w-[440px] lg:rounded-[28px] lg:shadow-[0_24px_60px_rgba(18,48,42,0.35)]"
    >
      <form
        className="flex max-h-[85dvh] flex-col gap-3 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return setProblem("Enter how much came in.");
          setProblem(null);
          onConfirm(chosen, amount);
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h2 className="font-display text-xl font-semibold">{heading}</h2>
            <p className="truncate text-[15px] text-muted">
              {item.name} ·{" "}
              <strong className={incoming ? "text-sea" : "text-ink"}>
                {incoming ? "+" : ""}
                {formatPeso(amount)}
              </strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {editable && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`log-amount-${item.key}`} className="text-sm font-bold">
              {incoming ? "How much came in" : "How much you paid"}
            </label>
            <div className="relative">
              <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
              <AmountInput
                id={`log-amount-${item.key}`}
                value={typed}
                onChange={(v) => {
                  setProblem(null);
                  setTyped(v);
                }}
                placeholder="0.00"
                className={`${FIELD_CLASS} w-full pl-8 text-right`}
              />
            </div>
            <p className="text-xs text-muted">Estimated {formatPeso(estimate)}. Change it to {incoming ? "what actually landed" : "what you actually paid"}.</p>
          </div>
        )}

        <fieldset className="flex min-h-0 flex-col overflow-y-auto rounded-[20px] bg-card px-1.5 py-1.5">
          <legend className="sr-only">{heading}</legend>
          {wallets.map((w) => {
            const after = roundCents(incoming ? w.balance + amount : w.balance - amount);
            const short = !incoming && after < 0;
            const selected = w.id === chosen;
            return (
              <label
                key={w.id}
                className={`flex cursor-pointer items-center gap-3 rounded-[14px] px-2.5 py-2.5 ${
                  selected ? "bg-sea-tint" : "hover:bg-line-soft"
                }`}
              >
                <input
                  type="radio"
                  name="wallet"
                  value={w.id}
                  checked={selected}
                  onChange={() => setChosen(w.id)}
                  className="h-5 w-5 shrink-0 accent-sea"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold">{w.name}</span>
                  <span className="text-[13px] text-muted">
                    {accountTypeLabel(w.type)}
                    {w.purpose !== "spending" && ` · ${purposeLabel(w.purpose)}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className={`font-display text-[17px] font-semibold ${w.balance < 0 ? "text-coral-text" : ""}`}>
                    {formatPeso(w.balance)}
                  </span>
                  <span className={`text-[13px] ${short ? "font-bold text-coral-text" : "text-muted"}`}>
                    {short ? "Not enough · " : "After: "}
                    {formatPeso(after)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{problem ?? error}</p>

        <button
          type="submit"
          disabled={pending}
          className={`h-14 shrink-0 rounded-[18px] text-[17px] font-extrabold disabled:opacity-60 ${
            incoming ? "bg-sun text-ink" : "bg-sea text-white"
          }`}
        >
          {pending ? "Saving…" : `${label} · ${formatPeso(amount)}`}
        </button>
      </form>
    </dialog>
  );
}

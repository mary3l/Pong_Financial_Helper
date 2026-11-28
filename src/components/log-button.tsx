"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { payInstallments, undoInstallment } from "@/app/credit-actions";
import { settlePerson } from "@/app/people-actions";
import { logPlanned, logRecurring, undoPayday } from "@/app/plan-actions";
import { deleteTransaction } from "@/app/transaction-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { CloseIcon } from "@/components/icons";
import type { Account } from "@/lib/data";
import type { ForecastItem, PayBreakdown } from "@/lib/forecast";
import { isContribution } from "@/lib/payroll";
import {
  accountTypeLabel,
  formatPeso,
  parseAmount,
  paysInPesos,
  purposeLabel,
  roundCents,
} from "@/lib/money";

/** Opens Add prefilled for an item, linked so saving logs that occurrence. */
/** A payday's salary loan payments: logging it pays them from the pay. */
function salaryLoanIds(item: ForecastItem): string[] {
  if (item.kind !== "payday") return [];
  return (item.pay?.deductions ?? []).flatMap((d) => (d.loanPaymentId ? [d.loanPaymentId] : []));
}

export function prefillHref(item: ForecastItem): string {
  const query = new URLSearchParams({
    type: item.flow === "in" ? "income" : "expense",
    note: item.name,
  });
  if (item.amount) query.set("amount", String(item.amount));
  if (item.category) query.set("category", item.category);
  if (item.accountId) query.set("account", item.accountId);
  if (item.kind === "payday" || item.kind === "income" || item.kind === "bill") {
    query.set("link", `${item.id}|${item.scheduledOn ?? item.dueOn}`);
  }
  return `/add?${query}`;
}

// "Mark paid" for money going out, "Add income" for money coming in. Either
// first asks which wallet (showing each one's balance before and after), then
// logs the real transaction at the scheduled amount; undo deletes it, which
// un-marks the item. An installment logs a transfer plus its fee; utang and
// pautang settle the whole balance (a transfer, never spending).
export function LogButton({
  item,
  accounts,
  early = false,
  label: labelAs,
}: {
  item: ForecastItem;
  accounts: Account[];
  /** Due a while from now: "Pay early" instead of "Mark paid". */
  early?: boolean;
  /** The button's word instead, like the payment plan's "Pay". */
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const paid = Boolean(item.transactionId);
  const incoming = item.flow === "in";
  // A set-aside moves money into savings: picked from any wallet but that one.
  const setAside = item.setAsideTo !== undefined;
  const label =
    labelAs ??
    (incoming ? "Add income" : setAside ? "Set aside" : early ? "Pay early" : "Mark paid");
  // Scheduled items are in pesos, so dollar wallets aren't offered.
  const wallets = accounts.filter((a) => paysInPesos(a) && !a.archived && a.id !== item.setAsideTo);

  function run(walletId?: string, amount?: number, loanIds?: string[]) {
    setError(null);
    startTransition(async () => {
      const result = await (item.kind === "utang" || item.kind === "pautang"
        ? settlePerson(item.id, walletId)
        : item.kind === "installment"
          ? paid
            ? undoInstallment(item.id)
            : payInstallments([item.id], walletId)
          : paid
            ? item.kind === "payday"
              ? undoPayday(item.transactionId!)
              : deleteTransaction(item.transactionId!)
            : item.kind === "planned"
              ? logPlanned(item.id, walletId)
              : logRecurring(
                  item.id,
                  item.dueOn,
                  walletId,
                  amount ?? item.amount ?? undefined,
                  // Unticked in the payday checklist: not taken this time, so not paid.
                  loanIds ?? salaryLoanIds(item),
                ));
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
    paid
      ? "border-2 border-line bg-card text-ink"
      : incoming
        ? "bg-sun text-ink"
        : "bg-sea text-white"
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
          {pending && !picking
            ? "Saving…"
            : paid
              ? `${incoming ? "Received" : setAside ? "Set aside" : "Paid"} · undo`
              : label}
        </button>
      )}
      {paid && !pending && (
        <Link
          href={`/activity/${item.transactionId}`}
          className="text-xs font-extrabold text-sea-dark underline"
        >
          Edit amount
        </Link>
      )}
      {!picking && (
        <p
          role="alert"
          className="max-w-40 text-right text-xs font-bold text-coral-text empty:hidden"
        >
          {error}
        </p>
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
  onConfirm: (walletId: string, amount: number, loanIds?: string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const incoming = item.flow === "in";
  // A payday your office takes contributions from: a checklist of gross pay
  // and each deduction, ticked and editable, and what lands is the rest.
  const breakdown = item.kind === "payday" ? (item.pay ?? null) : null;
  const [pay, setPay] = useState(() => payTexts(breakdown));
  // Every deduction starts ticked: taken this payday.
  const [taken, setTaken] = useState(() => breakdown?.deductions.map(() => true) ?? []);
  // Any other estimate (a payday without a breakdown, a bill that varies):
  // first asks whether it's right; "No" opens the amount. Installments,
  // utang and planned items log their own amounts.
  const editable =
    !breakdown &&
    item.estimate &&
    (item.kind === "payday" || item.kind === "income" || item.kind === "bill");
  const [changing, setChanging] = useState(false);
  const [typed, setTyped] = useState(() => String(estimate));
  const parsed = breakdown
    ? netOf(pay, taken)
    : editable && changing
      ? parseAmount(typed)
      : estimate;
  const valid = Number.isFinite(parsed) && parsed > 0;
  const amount = valid ? parsed : estimate;
  // The salary loans ticked: paid from the pay as it lands.
  const loanIds = breakdown?.deductions.flatMap((d, i) =>
    taken[i] && d.loanPaymentId ? [d.loanPaymentId] : [],
  );
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

  const heading = incoming
    ? "Where does it go?"
    : item.setAsideTo !== undefined
      ? "Move it from"
      : "Pay it from";

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
        className="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid)
            return setProblem(breakdown ? "Check the amounts." : "Enter how much came in.");
          setProblem(null);
          onConfirm(chosen, amount, loanIds);
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
          <div
            role="group"
            aria-labelledby={`log-estimate-${item.key}`}
            className="flex flex-col gap-2 rounded-[20px] border-2 border-line px-4 py-3"
          >
            <p id={`log-estimate-${item.key}`} className="flex flex-col">
              <span className="font-bold">Is the estimate right?</span>
              <span className="text-[13px] text-muted">
                {formatPeso(estimate)} is{" "}
                {item.kind === "payday" ? "what the payroll calculator expects" : "an estimate"}.
              </span>
            </p>
            <div className="flex gap-2">
              <ChoiceChip
                selected={!changing}
                onClick={() => {
                  setProblem(null);
                  setChanging(false);
                }}
              >
                Yes
              </ChoiceChip>
              <ChoiceChip
                selected={changing}
                onClick={() => {
                  setProblem(null);
                  setTyped(String(estimate));
                  setChanging(true);
                }}
              >
                No, change it
              </ChoiceChip>
            </div>
            {changing && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`log-amount-${item.key}`} className="text-sm font-bold">
                  {incoming ? "How much came in" : "How much you paid"}
                </label>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted"
                  >
                    ₱
                  </span>
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
              </div>
            )}
          </div>
        )}

        {breakdown && (
          <div className="shrink-0 rounded-[20px] border-2 border-line px-4 py-3">
            <PayLines
              id={item.key}
              breakdown={breakdown}
              texts={pay}
              taken={taken}
              onChange={(next) => {
                setProblem(null);
                setPay(next);
              }}
              onTake={(i, on) => {
                setProblem(null);
                setTaken((t) => t.map((x, j) => (j === i ? on : x)));
              }}
            />
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
                  <span
                    className={`font-display text-[17px] font-semibold ${w.balance < 0 ? "text-coral-text" : ""}`}
                  >
                    {formatPeso(w.balance)}
                  </span>
                  <span
                    className={`text-[13px] ${short ? "font-bold text-coral-text" : "text-muted"}`}
                  >
                    {short ? "Not enough · " : "After: "}
                    {formatPeso(after)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
          {problem ?? error}
        </p>

        <button
          type="submit"
          disabled={pending || (breakdown !== null && !valid)}
          className={`h-14 shrink-0 rounded-[18px] text-[17px] font-extrabold disabled:opacity-60 ${
            incoming ? "bg-sun text-ink" : "bg-sea text-white"
          }`}
        >
          {pending
            ? "Saving…"
            : breakdown && !valid
              ? "Check the amounts"
              : `${label} · ${formatPeso(amount)}`}
        </button>
      </form>
    </dialog>
  );
}

type PayTexts = { gross: string; deductions: string[] };

function payTexts(breakdown: PayBreakdown | null): PayTexts {
  return {
    gross: breakdown ? String(breakdown.gross) : "",
    deductions: breakdown ? breakdown.deductions.map((d) => String(d.amount)) : [],
  };
}

/**
 * Gross minus each deduction that's ticked (all of them without `taken`), or
 * NaN while an amount doesn't parse. An unticked one isn't checked at all.
 */
export function netOf(texts: PayTexts, taken?: boolean[]): number {
  const gross = parseAmount(texts.gross);
  const counted = texts.deductions.filter((_, i) => taken?.[i] ?? true);
  const amounts = counted.map((t) => (t.trim() ? parseAmount(t) : 0));
  if (!(gross > 0) || amounts.some((t) => !(t >= 0))) return NaN;
  return roundCents(gross - amounts.reduce((sum, t) => sum + t, 0));
}

/**
 * A payday as a checklist: gross pay, then each deduction with a tick (taken
 * this payday) and its amount, and what lands in the bank. Gross, contributions
 * and tax can be changed; a salary loan pays its scheduled payment, so only
 * its tick can.
 */
function PayLines({
  id,
  breakdown,
  texts,
  taken,
  onChange,
  onTake,
}: {
  id: string;
  breakdown: PayBreakdown;
  texts: PayTexts;
  taken: boolean[];
  onChange: (texts: PayTexts) => void;
  onTake: (index: number, taken: boolean) => void;
}) {
  const net = netOf(texts, taken);
  const amountField = (key: string, label: string, value: string, set: (v: string) => void) => (
    <div className="relative w-32 shrink-0">
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-3 -translate-y-1/2 font-bold text-muted"
      >
        ₱
      </span>
      <AmountInput
        id={`pay-${id}-${key}`}
        aria-label={label}
        value={value}
        onChange={set}
        placeholder="0.00"
        className={`${FIELD_CLASS} h-10 w-full pl-7 text-right`}
      />
    </div>
  );
  // Contributions, then tax and the rest, then salary loans: a heading over each.
  const groupOf = (d: PayBreakdown["deductions"][number]) =>
    d.loanPaymentId ? "Salary loans" : isContribution(d.kind) ? "Contributions" : "Taken too";
  return (
    <div className="flex flex-col gap-1.5 text-[15px]">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`pay-${id}-gross`} className="min-w-0 flex-1 truncate font-bold">
          Gross pay
        </label>
        {amountField("gross", "Gross pay", texts.gross, (v) => onChange({ ...texts, gross: v }))}
      </div>
      {breakdown.deductions.map((d, i) => {
        const on = taken[i];
        const group = groupOf(d);
        return (
          <div key={`d${i}`} className="flex flex-col gap-1.5">
            {(i === 0 || groupOf(breakdown.deductions[i - 1]) !== group) && (
              <span className="mt-1 text-[13px] font-extrabold text-muted uppercase">{group}</span>
            )}
            <div className="flex min-h-10 items-center justify-between gap-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onTake(i, e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-sea"
                />
                <span className={`truncate ${on ? "" : "text-muted line-through"}`}>
                  − {d.name}
                </span>
              </label>
              {d.loanPaymentId ? (
                <span className={`shrink-0 font-bold ${on ? "" : "text-muted line-through"}`}>
                  {formatPeso(d.amount)}
                </span>
              ) : (
                <div className={on ? "" : "opacity-50"}>
                  {amountField(`d${i}`, d.name, texts.deductions[i], (v) =>
                    onChange({
                      ...texts,
                      deductions: texts.deductions.map((t, j) => (j === i ? v : t)),
                    }),
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex items-baseline justify-between gap-3 border-t-2 border-line-soft pt-1.5">
        <span className="font-extrabold">= Lands in the bank</span>
        <span className={`font-extrabold ${net > 0 ? "" : "text-coral-text"}`}>
          {Number.isFinite(net) && net > 0 ? formatPeso(net) : "Check the amounts"}
        </span>
      </div>
    </div>
  );
}

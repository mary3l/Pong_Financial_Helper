"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addWallets, type WalletInput } from "@/app/wallet-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import type { Account } from "@/lib/data";
import { interestPresetFor, type InterestPreset } from "@/lib/interest-presets";
import {
  INTEREST_PAYOUTS,
  WALLET_PURPOSES,
  WALLET_TYPES,
  accountTypeLabel,
  canEarnInterest,
  formatBalance,
  isSpendable,
  parseAmount,
  purposeLabel,
  type WalletPurpose,
  type WalletType,
} from "@/lib/money";

type Row = {
  key: number;
  name: string;
  type: WalletType;
  purpose: WalletPurpose;
  amount: string;
  /** Preset rows have a fixed name; added rows let you type one. */
  custom: boolean;
  /** It earns interest (MariBank, Maya Savings, GoTyme): at `rate`% a year. */
  earns: boolean;
  rate: string;
};

type Preset = { name: string; type: WalletType; purpose: WalletPurpose };

/**
 * Banks and savings people here open in apps, one tap to add, with their
 * interest filled in (src/lib/interest-presets.ts). Only pesos: dollar time
 * deposits are added in Money.
 */
const QUICK_ADD: Record<"spending" | "saved", Preset[]> = {
  spending: [
    { name: "MariBank", type: "bank", purpose: "spending" },
    { name: "GoTyme", type: "bank", purpose: "spending" },
  ],
  saved: [
    { name: "MariBank Savings", type: "bank", purpose: "savings" },
    { name: "Maya Savings", type: "ewallet", purpose: "savings" },
    { name: "GoTyme GoalSave", type: "bank", purpose: "savings" },
    { name: "GSave", type: "ewallet", purpose: "savings" },
  ],
};

/** The interest a wallet's name points to, if Pong knows its rate (pesos only). */
function interestOf(row: Pick<Row, "name" | "type">): InterestPreset | null {
  const preset = interestPresetFor(row.name);
  return preset && preset.rate !== null && !preset.currency && canEarnInterest(row.type)
    ? preset
    : null;
}

/** Step 1: money you spend from. Step 2: money you keep aside, which isn't in what's left this week. */
const PRESETS: Record<"spending" | "saved", Preset[]> = {
  spending: [
    { name: "Cash", type: "cash", purpose: "spending" },
    { name: "GCash", type: "ewallet", purpose: "spending" },
    { name: "Maya", type: "ewallet", purpose: "spending" },
    { name: "Bank (payroll)", type: "bank", purpose: "spending" },
  ],
  saved: [{ name: "Emergency Savings", type: "bank", purpose: "emergency" }],
};

const SAVED_PURPOSES = WALLET_PURPOSES.filter((p) => p.value !== "spending");

let nextKey = 0;

export function WalletsForm({
  existing,
  purpose = "spending",
  next: nextStep,
}: {
  existing: Account[];
  /** Spending wallets (step 1) or savings (step 2). */
  purpose?: "spending" | "saved";
  /** The step after this one. */
  next: string;
}) {
  const saved = purpose === "saved";
  // Each step lists only its own kind of wallet.
  const shown = existing.filter((a) =>
    saved
      ? isSpendable(a.type) && a.purpose !== "spending"
      : isSpendable(a.type) && a.purpose === "spending",
  );
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() => {
    const taken = new Set(existing.map((a) => a.name.toLowerCase()));
    return PRESETS[purpose]
      .filter((p) => !taken.has(p.name.toLowerCase()))
      .map((p) => ({
        key: nextKey++,
        ...p,
        amount: "",
        custom: false,
        // Maya's preset row is the Maya Wallet, which doesn't earn: you turn it on for Maya Savings.
        earns: false,
        rate: String(interestOf(p)?.rate ?? ""),
      }));
  });
  const taken = new Set([...existing, ...rows].map((r) => r.name.toLowerCase()));

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow(preset?: Preset) {
    const interest = preset ? interestOf(preset) : null;
    setRows((rs) => [
      ...rs,
      {
        key: nextKey++,
        name: preset?.name ?? "",
        type: preset?.type ?? "bank",
        purpose: preset?.purpose ?? (saved ? "savings" : "spending"),
        amount: "",
        custom: true,
        earns: Boolean(interest),
        rate: String(interest?.rate ?? ""),
      },
    ]);
  }

  // Typing a known name (MariBank, Maya, GoTyme) fills in its interest, once.
  function rename(row: Row, name: string) {
    const before = interestOf(row);
    const after = interestOf({ ...row, name });
    update(
      row.key,
      after && after !== before
        ? { name, earns: true, rate: String(after.rate) }
        : !after
          ? { name, earns: false }
          : { name },
    );
  }

  function next() {
    setError(null);
    const wallets: WalletInput[] = [];
    for (const row of rows) {
      const name = row.name.trim();
      const typed = row.amount.trim();
      // A preset counts once you type an amount; an added row once it has a name.
      if (row.custom ? !name : !typed) continue;
      const balance = typed ? parseAmount(typed) : 0;
      if (Number.isNaN(balance)) {
        setError(`Check the amount for ${name || "your new wallet"}.`);
        return;
      }
      const interest = row.earns ? interestOf(row) : null;
      const rate = Number(row.rate.replace(/[%\s]/g, ""));
      if (interest && !(rate > 0 && rate <= 100)) {
        setError(`Check the interest rate for ${name}.`);
        return;
      }
      wallets.push({
        name,
        type: row.type,
        balance,
        ...(saved && { purpose: row.purpose }),
        ...(interest && { interestRate: rate, interestPayout: interest.payout }),
      });
    }

    startTransition(async () => {
      const result = await addWallets(wallets);
      if (result.error) setError(result.error);
      else router.push(nextStep);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {shown.length > 0 && (
        <section
          aria-label="Wallets you already added"
          className="flex flex-col rounded-3xl bg-card px-5 py-2"
        >
          {shown.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between border-b border-line-soft py-3 last:border-0"
            >
              <div className="flex flex-col">
                <span className="font-bold">{a.name}</span>
                <span className="text-sm text-muted">
                  {saved ? purposeLabel(a.purpose) : accountTypeLabel(a.type)}
                </span>
              </div>
              <span className="font-display text-lg font-semibold">{formatBalance(a)}</span>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
            <div className="flex items-center gap-3">
              {row.custom ? (
                <>
                  <label htmlFor={`name-${row.key}`} className="sr-only">
                    Wallet name
                  </label>
                  <input
                    id={`name-${row.key}`}
                    value={row.name}
                    onChange={(e) => rename(row, e.target.value)}
                    placeholder="e.g. MariBank"
                    maxLength={60}
                    className={`${FIELD_CLASS} flex-1`}
                  />
                </>
              ) : (
                <label htmlFor={`amount-${row.key}`} className="flex-1 text-base font-bold">
                  {row.name}
                </label>
              )}
              <div className="relative w-36 shrink-0">
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted"
                >
                  ₱
                </span>
                <AmountInput
                  id={`amount-${row.key}`}
                  value={row.amount}
                  onChange={(v) => update(row.key, { amount: v })}
                  placeholder="0.00"
                  aria-label={row.custom ? "Amount in it now" : undefined}
                  className={`${FIELD_CLASS} w-full pl-8 text-right`}
                />
              </div>
            </div>
            <InterestLine row={row} onChange={(patch) => update(row.key, patch)} />
            {row.custom && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-muted" id={`type-${row.key}`}>
                  Type
                </span>
                <div
                  role="group"
                  aria-labelledby={`type-${row.key}`}
                  className="flex flex-wrap gap-2"
                >
                  {WALLET_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={row.type === t.value}
                      onClick={() => update(row.key, { type: t.value })}
                      className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${
                        row.type === t.value ? "bg-ink text-mint" : "bg-mint text-ink"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {saved && (
                  <div
                    role="group"
                    aria-label="What it's for"
                    className="flex w-full flex-wrap gap-2"
                  >
                    {SAVED_PURPOSES.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        aria-pressed={row.purpose === p.value}
                        onClick={() => update(row.key, { purpose: p.value })}
                        className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${
                          row.purpose === p.value ? "bg-ink text-mint" : "bg-mint text-ink"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                  className="ml-auto h-9 px-2 text-sm font-extrabold text-coral-text"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}

        <div role="group" aria-label="Add one of these" className="flex flex-wrap gap-2">
          {QUICK_ADD[purpose]
            .filter((p) => !taken.has(p.name.toLowerCase()))
            .map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => addRow(p)}
                className="h-10 rounded-full bg-mint px-4 text-sm font-extrabold text-ink hover:bg-sea-tint"
              >
                + {p.name}
              </button>
            ))}
        </div>
        <button
          type="button"
          onClick={() => addRow()}
          className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
        >
          {saved ? "+ Add another" : "+ Add another bank or e-wallet"}
        </button>
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <p role="alert" className="min-h-5 text-sm font-bold text-coral-text">
          {error}
        </p>
        <button
          type="button"
          onClick={next}
          disabled={pending}
          className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : "Next"}
        </button>
        <Link
          href={nextStep}
          className="flex h-11 items-center justify-center font-extrabold text-sea-dark"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}

/** "Earns interest" with its rate and when it's added, for a wallet Pong knows. */
function InterestLine({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const preset = interestOf(row);
  if (!preset) return null;
  const payout = INTEREST_PAYOUTS.find((p) => p.value === preset.payout)?.label.toLowerCase();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <label className="flex min-h-9 items-center gap-2 font-bold">
        <input
          type="checkbox"
          checked={row.earns}
          onChange={(e) => onChange({ earns: e.target.checked })}
          className="h-5 w-5 accent-sea"
        />
        Earns interest
      </label>
      {row.earns && (
        <span className="flex items-center gap-1.5 text-muted">
          <input
            aria-label={`${row.name || "Wallet"} interest rate`}
            value={row.rate}
            onChange={(e) => onChange({ rate: e.target.value })}
            inputMode="decimal"
            className={`${FIELD_CLASS} h-9 w-20 text-right`}
          />
          % a year · {payout}
        </span>
      )}
    </div>
  );
}

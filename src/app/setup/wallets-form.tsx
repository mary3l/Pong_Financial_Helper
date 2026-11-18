"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addWallets, type WalletInput } from "@/app/wallet-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import type { Account } from "@/lib/data";
import {
  WALLET_TYPES,
  accountTypeLabel,
  formatBalance,
  parseAmount,
  type WalletType,
} from "@/lib/money";

type Row = {
  key: number;
  name: string;
  type: WalletType;
  amount: string;
  /** Preset rows have a fixed name; added rows let you type one. */
  custom: boolean;
};

const PRESETS: { name: string; type: WalletType }[] = [
  { name: "Cash", type: "cash" },
  { name: "GCash", type: "ewallet" },
  { name: "Maya", type: "ewallet" },
  { name: "Bank (payroll)", type: "bank" },
];

let nextKey = 0;

export function WalletsForm({ existing }: { existing: Account[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() => {
    const taken = new Set(existing.map((a) => a.name.toLowerCase()));
    return PRESETS.filter((p) => !taken.has(p.name.toLowerCase())).map((p) => ({
      key: nextKey++,
      ...p,
      amount: "",
      custom: false,
    }));
  });

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow() {
    setRows((rs) => [...rs, { key: nextKey++, name: "", type: "bank", amount: "", custom: true }]);
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
      wallets.push({ name, type: row.type, balance });
    }

    startTransition(async () => {
      const result = await addWallets(wallets);
      if (result.error) setError(result.error);
      else router.push("/setup/payday");
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {existing.length > 0 && (
        <section
          aria-label="Wallets you already added"
          className="flex flex-col rounded-3xl bg-card px-5 py-2"
        >
          {existing.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between border-b border-line-soft py-3 last:border-0"
            >
              <div className="flex flex-col">
                <span className="font-bold">{a.name}</span>
                <span className="text-sm text-muted">{accountTypeLabel(a.type)}</span>
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
                    onChange={(e) => update(row.key, { name: e.target.value })}
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

        <button
          type="button"
          onClick={addRow}
          className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
        >
          + Add another bank or e-wallet
        </button>
        <p className="text-sm leading-relaxed text-muted">
          MariBank and GoTyme are banks. SPayLater, Atome and loans arrive in a later update.
        </p>
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
          href="/setup/payday"
          className="flex h-11 items-center justify-center font-extrabold text-sea-dark"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useId, useState } from "react";
import { ChevronIcon } from "@/components/icons";
import type { Account } from "@/lib/data";
import { formatMoney, groupAccounts, isSpendable } from "@/lib/money";

// Groups shown open before you tap their heading: the rest fold so the list stays short.
const OPEN_GROUPS = 2;

/** What a wallet holds; credit lines, loans and people show none. */
function balanceOf(a: Account): string | null {
  return isSpendable(a.type) ? formatMoney(a.balance, a.currency) : null;
}

/**
 * Wallets as chips under a heading per kind. Once one is picked the list
 * folds to a single row with Change, so Pay with, From and To stay short.
 */
export function WalletPicker({
  label,
  selected,
  onPick,
  list,
}: {
  label: string;
  selected: string;
  onPick: (id: string) => void;
  list: Account[];
}) {
  const id = useId();
  const picked = list.find((a) => a.id === selected);
  const [open, setOpen] = useState(!picked);
  const groups = groupAccounts(list);
  // Folded groups you've opened.
  const [shown, setShown] = useState<Set<string>>(new Set());

  if (picked && !open) {
    const balance = balanceOf(picked);
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-2xl bg-card py-1.5 pr-1.5 pl-3.5">
        <span className="w-12 shrink-0 text-[13px] font-extrabold text-muted">{label}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{picked.name}</span>
        {balance && <span className="shrink-0 text-[13px] font-bold text-muted">{balance}</span>}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Change ${label}: ${picked.name}`}
          className="h-8 shrink-0 rounded-full px-3 text-[13px] font-extrabold text-sea-dark hover:bg-sea-tint"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-extrabold">{label}</span>
      <div role="group" aria-label={label} className="flex flex-col gap-2">
        {groups.map((g, i) => {
          const isShown =
            i < OPEN_GROUPS || shown.has(g.key) || g.accounts.some((a) => a.id === selected);
          return (
            <div key={g.key} className="flex flex-col gap-1">
              {groups.length > 1 &&
                (isShown ? (
                  <span className="text-[11px] font-extrabold tracking-wide text-muted uppercase">
                    {g.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-expanded={false}
                    onClick={() => setShown((s) => new Set(s).add(g.key))}
                    className="flex items-center gap-1 self-start text-[11px] font-extrabold tracking-wide text-muted uppercase hover:text-ink"
                  >
                    {g.label} · {g.accounts.length}
                    <ChevronIcon size={12} />
                  </button>
                ))}
              {isShown && (
                <div className="flex flex-wrap gap-2">
                  {g.accounts.map((a) => {
                    const balance = balanceOf(a);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={selected === a.id}
                        aria-describedby={balance ? `${id}-${a.id}` : undefined}
                        onClick={() => {
                          onPick(a.id);
                          setOpen(false);
                        }}
                        className={`flex min-h-9 max-w-full flex-col items-start justify-center rounded-2xl px-3.5 py-1.5 text-left ${
                          selected === a.id
                            ? "bg-ink text-mint"
                            : "bg-card text-ink hover:bg-sea-tint"
                        }`}
                      >
                        <span className="max-w-full truncate text-sm leading-tight font-extrabold">
                          {a.name}
                        </span>
                        {balance && (
                          <span
                            id={`${id}-${a.id}`}
                            // Read as the chip's description, not its name.
                            aria-hidden="true"
                            className={`text-xs leading-tight font-bold ${
                              selected === a.id ? "text-mint/75" : "text-muted"
                            }`}
                          >
                            {balance}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { estimateDeduction, updateDeduction } from "@/app/payroll-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { addDays, formatShortDay } from "@/lib/dates";
import { formatPeso, parseAmount, roundCents } from "@/lib/money";
import {
  paydayAmounts,
  resolveDeductions,
  type PayrollSettings,
  type SavedDeduction,
} from "@/lib/payroll";
import type { Schedule } from "@/lib/schedule";

/**
 * Step 4 of setup, for employees: what their office takes from their pay,
 * as Pong's estimates. Type your payslip's amount over any of them; empty
 * goes back to the estimate. The next paydays show gross − taken = net.
 */
export function DeductionsStep({
  settings,
  saved,
  schedule,
  today,
  next,
}: {
  settings: PayrollSettings;
  /** As saved: no amount is Pong's estimate. */
  saved: SavedDeduction[];
  schedule: Schedule;
  today: string;
  next: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What you typed for each, by id: "" is Pong's estimate.
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(saved.map((d) => [d.id, d.amount === null ? "" : String(d.amount)])),
  );

  const estimable = (d: SavedDeduction) => d.kind !== undefined && d.kind !== "other";
  const current: SavedDeduction[] = saved.map((d) => {
    if (!estimable(d)) return d;
    const text = typed[d.id]?.trim() ?? "";
    const value = text ? parseAmount(text) : NaN;
    return { ...d, amount: value > 0 ? value : null };
  });
  const estimates = resolveDeductions(
    settings,
    current.map((d) => ({ ...d, amount: estimable(d) ? null : d.amount })),
  );
  const resolved = resolveDeductions(settings, current);
  const amounts = paydayAmounts(
    { settings, days: [], overtime: [], deductions: resolved },
    schedule,
    today,
    addDays(today, 45),
    today,
  );
  const paydays = Object.keys(amounts).sort().slice(0, 2);

  function save() {
    setError(null);
    for (const d of saved) {
      const text = typed[d.id]?.trim() ?? "";
      if (estimable(d) && text && !(parseAmount(text) > 0)) {
        setError(`Check the amount for ${d.name}.`);
        return;
      }
    }
    startTransition(async () => {
      for (const d of saved) {
        if (!estimable(d)) continue;
        const text = typed[d.id]?.trim() ?? "";
        const was = d.amount === null ? "" : String(d.amount);
        if (text === was) continue;
        const result = text
          ? await updateDeduction(d.id, d.name, parseAmount(text))
          : await estimateDeduction(d.id);
        if (result.error) return setError(result.error);
      }
      router.push(next);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <section
        aria-label="Taken from your pay"
        className="flex flex-col gap-3 rounded-[20px] bg-card p-4"
      >
        {resolved.map((d, i) => (
          <div key={d.id} className="flex items-center gap-3">
            <label htmlFor={`taken-${d.id}`} className="flex min-w-0 flex-1 flex-col">
              <span className="font-bold break-words">{d.name}</span>
              <span className="text-xs text-muted">
                {d.estimated ? "Estimate" : "Your amount"} ·{" "}
                {d.taken === "each" ? "split over each payday" : "last payday of the month"}
              </span>
            </label>
            {estimable(saved[i]) ? (
              <div className="relative w-32 shrink-0">
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-3 -translate-y-1/2 font-bold text-muted"
                >
                  ₱
                </span>
                <AmountInput
                  id={`taken-${d.id}`}
                  value={typed[d.id] ?? ""}
                  onChange={(v) => setTyped((t) => ({ ...t, [d.id]: v }))}
                  placeholder={estimates[i].amount.toFixed(2)}
                  className={`${FIELD_CLASS} w-full pl-7 text-right`}
                />
              </div>
            ) : (
              <span className="font-bold">{formatPeso(d.amount)}</span>
            )}
          </div>
        ))}
        <div className="flex items-baseline justify-between border-t-2 border-line-soft pt-2">
          <span className="font-extrabold">Each month</span>
          <span className="font-extrabold">
            {formatPeso(roundCents(resolved.reduce((sum, d) => sum + d.amount, 0)))}
          </span>
        </div>
        <p className="text-[13px] text-muted">
          Estimates from your gross pay · type your payslip&apos;s to replace one
        </p>
      </section>

      {paydays.length > 0 && (
        <section aria-label="Your next paydays" className="flex flex-col gap-1.5">
          {paydays.map((date) => {
            const a = amounts[date];
            const gross = a.gross ?? a.amount;
            return (
              <p key={date} className="rounded-[14px] bg-sea-tint px-3 py-2 text-[15px]">
                <strong>{formatShortDay(date, today)} payday</strong>: {formatPeso(gross)} −{" "}
                {formatPeso(roundCents(gross - a.amount))} = <strong>{formatPeso(a.amount)}</strong>
              </p>
            );
          })}
        </section>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <p role="alert" className="min-h-5 text-sm font-bold text-coral-text">
          {error}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : "Next"}
        </button>
        <Link
          href={next}
          className="flex h-11 items-center justify-center font-extrabold text-sea-dark"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCreditLine, updateCreditLine } from "@/app/credit-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import type { Account } from "@/lib/data";
import { formatShortDay, today as getToday } from "@/lib/dates";
import { bnplFirstDue } from "@/lib/installments";
import { parseAmount } from "@/lib/money";

// BNPL apps, and banks that turn purchases into installments.
const PROVIDERS = ["SPayLater", "Atome", "MariBank Credit", "GoTyme Credit", "GGives", "Home Credit"];

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Adds a BNPL credit line, or edits `account`. */
export function CreditLineForm({ account, onDone }: { account?: Account; onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(account?.name ?? "SPayLater");
  const [limit, setLimit] = useState(account?.creditLimit ? String(account.creditLimit) : "");
  const [dueDay, setDueDay] = useState(account?.dueDay ? String(account.dueDay) : "5");
  const [cutoffDay, setCutoffDay] = useState(account?.cutoffDay ? String(account.cutoffDay) : "");
  const [used, setUsed] = useState(account ? String(Math.max(0, -account.balance)) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = account?.id ?? "new";

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const limitValue = limit.trim() ? parseAmount(limit) : null;
    const usedValue = used.trim() ? parseAmount(used) : 0;
    if (Number.isNaN(limitValue) || Number.isNaN(usedValue)) {
      setError("Check the amounts.");
      return;
    }
    const input = {
      name,
      limit: limitValue,
      dueDay: dueDay ? Number(dueDay) : null,
      cutoffDay: cutoffDay ? Number(cutoffDay) : null,
      used: usedValue,
    };
    startTransition(async () => {
      const result = account ? await updateCreditLine(account.id, input) : await addCreditLine(input);
      if (result.error) setError(result.error);
      else if (onDone) onDone();
      else router.push(`/money/${result.id}`);
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      {!account && (
        <div role="group" aria-label="Provider" className="flex flex-wrap gap-2">
          {[...PROVIDERS, "Other"].map((p) => (
            <ChoiceChip
              key={p}
              selected={p === "Other" ? !PROVIDERS.includes(name) : name === p}
              onClick={() => setName(p === "Other" ? "" : p)}
              className={(p === "Other" ? !PROVIDERS.includes(name) : name === p) ? "" : "bg-mint"}
            >
              {p}
            </ChoiceChip>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`credit-name-${id}`} className="text-sm font-bold">Name</label>
        <input id={`credit-name-${id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={FIELD_CLASS} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`credit-limit-${id}`} className="text-sm font-bold">
            Credit limit <span className="font-semibold text-muted">(optional)</span>
          </label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
            <AmountInput id={`credit-limit-${id}`} value={limit} onChange={setLimit} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`credit-due-${id}`} className="text-sm font-bold">Bill due every</label>
          <select id={`credit-due-${id}`} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={FIELD_CLASS}>
            <option value="">Not sure</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>Day {d}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`credit-cutoff-${id}`} className="text-sm font-bold">
          Statement cuts off <span className="font-semibold text-muted">(optional)</span>
        </label>
        <select id={`credit-cutoff-${id}`} value={cutoffDay} onChange={(e) => setCutoffDay(e.target.value)} className={FIELD_CLASS}>
          <option value="">Not sure</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </select>
        <span className="text-xs text-muted">
          <CutoffHint dueDay={dueDay ? Number(dueDay) : null} cutoffDay={cutoffDay ? Number(cutoffDay) : null} />
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`credit-used-${id}`} className="text-sm font-bold">You owe on it now</label>
        <div className="relative">
          <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
          <AmountInput id={`credit-used-${id}`} value={used} onChange={setUsed} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
        </div>
        <span className="text-xs text-muted">
          {account
            ? "Changing this adjusts the starting balance. Your logged purchases and payments stay as they are."
            : "Already paying something off? Put the total here, or log each purchase with + to get its payment plan."}
        </span>
      </div>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : account ? "Update credit line" : "Add credit line"}
        </button>
        <button
          type="button"
          onClick={() => (onDone ? onDone() : router.push("/money"))}
          className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-mint"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** What the cutoff means for something bought today. */
function CutoffHint({ dueDay, cutoffDay }: { dueDay: number | null; cutoffDay: number | null }) {
  if (!cutoffDay) {
    return <>The day the statement closes, in the app&apos;s billing or statement screen. Without it I guess: the next due day at least a week after you buy.</>;
  }
  if (!dueDay) return <>Pick the bill&apos;s due day too.</>;
  const today = getToday();
  return (
    <>
      Bought on or before day {cutoffDay}, it&apos;s on that statement; after it, the next one. Bought today:
      due {formatShortDay(bnplFirstDue(today, dueDay, cutoffDay), today)}.
    </>
  );
}

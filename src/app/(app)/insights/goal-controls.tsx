"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeGoal, saveGoal } from "@/app/goal-actions";
import { saveBudget } from "@/app/plan-actions";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { showToast } from "@/components/toast";
import { formatShortDay, isValidDate } from "@/lib/dates";
import { MAX_AMOUNT, formatPeso, parseAmount } from "@/lib/money";

// Insights' buttons and the new goal form. The page works everything out on
// the server; these only save.

export type GoalPrefill = { category: string; sub: string; limit: number; endsOn: string };

export function GoalForm({
  categories,
  subcategories,
  usual,
  ends,
  today,
  prefill,
}: {
  categories: { key: string; label: string }[];
  /** Subcategories used before, per category, most used first. */
  subcategories: Record<string, string[]>;
  /** Your usual per kinsenas, per category: a hint so the goal is one you can reach. */
  usual: Record<string, number>;
  /** The end of this kinsenas and of this month, to pick with one tap. */
  ends: { kinsenas: string; month: string };
  today: string;
  /** From a suggestion's Make it a goal. */
  prefill: GoalPrefill | null;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(prefill?.category ?? "");
  const [sub, setSub] = useState(prefill?.sub ?? "");
  const [amountText, setAmountText] = useState(prefill ? String(prefill.limit) : "");
  const [endsOn, setEndsOn] = useState(prefill?.endsOn ?? ends.kinsenas);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = parseAmount(amountText);
  const label = categories.find((c) => c.key === category)?.label;
  const hint = category ? usual[category] : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) return setError("Pick a category.");
    if (!(amount > 0 && amount <= MAX_AMOUNT)) return setError("Enter an amount above ₱0.");
    if (!isValidDate(endsOn) || endsOn < today) return setError("Pick an end date from today on.");
    setError(null);
    startTransition(async () => {
      const result = await saveGoal({ category, subcategory: sub, limit: amount, endsOn });
      if (result.error) return setError(result.error);
      showToast("Goal set");
      // Drop the suggestion's prefill from the URL, so the form starts empty next time.
      const url = new URL(window.location.href);
      for (const key of ["goal", "gc", "gs", "gl", "ge"]) url.searchParams.delete(key);
      router.replace(`${url.pathname}${url.search}#goals`, { scroll: false });
      setCategory("");
      setSub("");
      setAmountText("");
      setEndsOn(ends.kinsenas);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 pt-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="goal-category" className="text-xs font-bold text-muted">
            Category
          </label>
          <select
            id="goal-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSub("");
            }}
            className={FIELD_CLASS}
          >
            <option value="">Pick one</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="goal-sub" className="text-xs font-bold text-muted">
            Subcategory (optional)
          </label>
          <input
            id="goal-sub"
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            list="goal-subs"
            maxLength={40}
            placeholder="All of it"
            disabled={!category}
            className={`${FIELD_CLASS} disabled:opacity-60`}
          />
          <datalist id="goal-subs">
            {(subcategories[category] ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="goal-amount" className="text-xs font-bold text-muted">
          Spend under
        </label>
        <input
          id="goal-amount"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="₱0"
          className={FIELD_CLASS}
        />
        {hint !== undefined && (
          <p className="text-[13px] text-muted">
            You usually spend {formatPeso(hint)} a kinsenas on {label}. A goal a little under that
            is one you can keep.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="goal-until" className="text-xs font-bold text-muted">
          Until
        </span>
        <div role="group" aria-labelledby="goal-until" className="flex flex-wrap gap-2">
          <ChoiceChip selected={endsOn === ends.kinsenas} onClick={() => setEndsOn(ends.kinsenas)}>
            End of kinsenas · {formatShortDay(ends.kinsenas, today)}
          </ChoiceChip>
          {ends.month !== ends.kinsenas && (
            <ChoiceChip selected={endsOn === ends.month} onClick={() => setEndsOn(ends.month)}>
              End of month · {formatShortDay(ends.month, today)}
            </ChoiceChip>
          )}
          <label className="sr-only" htmlFor="goal-date">
            Or pick a day
          </label>
          <input
            id="goal-date"
            type="date"
            min={today}
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="h-10 rounded-full border-2 border-line bg-card px-3 text-sm font-bold"
          />
        </div>
      </div>

      {category && amount > 0 && (
        <p className="rounded-[14px] bg-sea-tint px-3.5 py-2.5 text-[15px] text-sea-dark">
          Spend under <b>{formatPeso(amount)}</b> on{" "}
          <b>
            {label}
            {sub.trim() ? ` › ${sub.trim()}` : ""}
          </b>{" "}
          from today until <b>{formatShortDay(endsOn, today)}</b>.
        </p>
      )}
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="h-[52px] rounded-[18px] bg-sun font-extrabold text-ink disabled:opacity-60"
      >
        {pending ? "Saving…" : "Set goal"}
      </button>
    </form>
  );
}

export function RemoveGoalButton({ id, label }: { id: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onBlur={() => setConfirm(false)}
      onClick={() => {
        if (!confirm) return setConfirm(true);
        startTransition(async () => {
          const result = await removeGoal(id);
          showToast(result.error ?? "Goal removed");
        });
      }}
      aria-label={confirm ? `Tap again to remove ${label}` : `Remove ${label}`}
      className={`h-9 shrink-0 rounded-full px-3 text-xs font-extrabold ${
        confirm ? "bg-coral text-white" : "bg-mint text-muted"
      }`}
    >
      {pending ? "…" : confirm ? "Tap again" : "Remove"}
    </button>
  );
}

export function SetBudgetButton({
  category,
  amount,
  label,
}: {
  category: string;
  amount: number;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await saveBudget(category, amount);
          showToast(result.error ?? `${label} budget set: ${formatPeso(amount)} a kinsenas`);
        })
      }
      className="h-10 shrink-0 rounded-full bg-sun px-4 text-sm font-extrabold text-ink disabled:opacity-60"
    >
      {pending ? "Setting…" : "Set budget"}
    </button>
  );
}

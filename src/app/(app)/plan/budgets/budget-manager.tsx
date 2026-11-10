"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { removeBudget, saveBudget } from "@/app/plan-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { FormDialog } from "@/components/form-dialog";
import { PathIcon } from "@/components/icons";
import { Pong } from "@/components/pong";
import { EXPENSE_CATEGORIES, categoryInfo } from "@/lib/categories";
import { formatPeso, parseAmount } from "@/lib/money";

export type BudgetRow = {
  id: string;
  category: string;
  /** What's saved: the limit for one kinsenas. */
  perKinsenas: number;
  /** The limit for the period on screen. */
  limit: number;
  spent: number;
};

/** Warn from 80% used. */
const WARN_AT = 0.8;

export function BudgetManager({ rows, view }: { rows: BudgetRow[]; view: "kinsenas" | "month" }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const free = EXPENSE_CATEGORIES.filter((c) => !rows.some((r) => r.category === c.key));
  const edited = rows.find((r) => r.id === editing) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {edited && (
        <FormDialog title={`${categoryInfo("expense", edited.category).label} budget`} onClose={() => setEditing(null)}>
          <BudgetForm row={edited} onDone={() => setEditing(null)} />
        </FormDialog>
      )}
      {adding && (
        <FormDialog title="Add budget" onClose={() => setAdding(false)}>
          <BudgetForm categories={free} onDone={() => setAdding(false)} />
        </FormDialog>
      )}
      {rows.length ? (
        <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-line-soft py-3 last:border-0">
              <BudgetLine row={r} onEdit={() => setEditing(r.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-8 text-center">
          <Pong mood="listen" size={100} decorative />
          <p className="max-w-xs text-[15px] text-muted">
            Set a limit per kinsenas for things like Food or Groceries, and I&apos;ll tell you when you&apos;re close.
          </p>
        </div>
      )}

      {free.length > 0 && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
          className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
        >
          + Add budget
        </button>
      )}
      {view === "month" && rows.length > 0 && (
        <p className="-mt-2 text-xs text-muted">Budgets are set per kinsenas, so a month is double.</p>
      )}
    </div>
  );
}

function BudgetLine({ row, onEdit }: { row: BudgetRow; onEdit: () => void }) {
  const info = categoryInfo("expense", row.category);
  const share = row.spent / row.limit;
  const over = row.spent > row.limit;
  const warn = !over && share >= WARN_AT;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${info.tint}`}>
          <PathIcon d={info.icon} size={19} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-bold">{info.label}</span>
          <span className="text-[13px] text-muted">
            {formatPeso(row.spent)} of {formatPeso(row.limit)}
          </span>
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${info.label} budget`}
          className="h-11 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
        >
          Edit
        </button>
      </div>
      <div
        role="progressbar"
        aria-label={`${info.label} budget used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(share * 100))}
        className="h-2 overflow-hidden rounded-full bg-line-soft"
      >
        <div
          className={`h-full rounded-full ${over ? "bg-coral" : warn ? "bg-sun" : "bg-sea"}`}
          style={{ width: `${Math.min(100, share * 100)}%` }}
        />
      </div>
      {(over || warn) && (
        <span className={`text-[13px] font-extrabold ${over ? "text-coral-text" : "text-sun-text"}`}>
          {over ? `Over by ${formatPeso(row.spent - row.limit)}` : `Heads up: ${Math.round(share * 100)}% used`}
        </span>
      )}
      {row.category === "groceries" && (
        <Link href="/grocery" className="self-start text-sm font-extrabold text-sea-dark">
          Start grocery trip ›
        </Link>
      )}
    </div>
  );
}

function BudgetForm({
  row,
  categories,
  onDone,
}: {
  /** The budget to edit; omit to add one. */
  row?: BudgetRow;
  /** Categories you can add a budget for. */
  categories?: typeof EXPENSE_CATEGORIES;
  onDone: () => void;
}) {
  const [category, setCategory] = useState(row?.category ?? categories?.[0]?.key ?? "");
  const [amount, setAmount] = useState(row ? String(row.perKinsenas) : "");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = row?.id ?? "new";

  function save(e: React.FormEvent) {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) {
      setError("Enter an amount above ₱0.");
      return;
    }
    startTransition(async () => {
      const result = await saveBudget(category, value);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  function remove() {
    if (!row) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    startTransition(async () => {
      const result = await removeBudget(row.id);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        {!row && (
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="budget-category" className="text-sm font-bold">Category</label>
            <select id="budget-category" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD_CLASS}>
              {categories?.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1 sm:w-48">
          <label htmlFor={`budget-amount-${id}`} className="text-sm font-bold">Per kinsenas</label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
            <AmountInput
              id={`budget-amount-${id}`}
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              required
              className={`${FIELD_CLASS} w-full pl-8 text-right`}
            />
          </div>
        </div>
      </div>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : row ? "Update budget" : "Add budget"}
        </button>
        <button type="button" onClick={onDone} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
          Cancel
        </button>
        {row && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className={`ml-auto h-11 rounded-[14px] px-4 font-extrabold ${confirmRemove ? "bg-coral text-white" : "text-coral-text hover:bg-coral-tint"}`}
          >
            {confirmRemove ? "Tap again to remove" : "Remove"}
          </button>
        )}
      </div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { addCategory, setCategoryHidden, updateCategory } from "@/app/category-actions";
import { FIELD_CLASS } from "@/components/choice-chip";
import { FormDialog } from "@/components/form-dialog";
import { PathIcon } from "@/components/icons";
import {
  CATEGORY_ICONS,
  CATEGORY_LABEL_MAX,
  CATEGORY_TINTS,
  categoriesFor,
  type UserCategory,
} from "@/lib/categories";

type Kind = "expense" | "income";

/** Yours (add, rename, hide), with the built-in ones under them. */
export function CategoryManager({ custom }: { custom: UserCategory[] }) {
  const [kind, setKind] = useState<Kind>("expense");
  // The category being changed, a new one (null), or closed (undefined).
  const [editing, setEditing] = useState<UserCategory | null | undefined>(undefined);
  const mine = custom.filter((c) => c.type === kind);
  const builtIn = categoriesFor(kind);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Type"
        className="grid grid-cols-2 gap-1 rounded-2xl bg-card p-1"
      >
        {(["expense", "income"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`h-10 rounded-xl text-sm ${kind === k ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"}`}
          >
            {k === "expense" ? "Expense" : "Income"}
          </button>
        ))}
      </div>

      {editing !== undefined && (
        <FormDialog
          title={editing ? `Change ${editing.label}` : "Add category"}
          onClose={() => setEditing(undefined)}
        >
          <CategoryForm kind={kind} category={editing} onDone={() => setEditing(undefined)} />
        </FormDialog>
      )}

      <section aria-label="Your categories" className="flex flex-col gap-2">
        <h2 className="text-[13px] font-extrabold text-muted">YOURS</h2>
        {mine.length > 0 && (
          <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
            {mine.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0"
              >
                <Swatch icon={c.icon} tint={c.tint} />
                <span className={`min-w-0 flex-1 font-bold ${c.hidden ? "text-muted" : ""}`}>
                  {c.label}
                  {c.hidden && <span className="text-xs font-semibold"> · hidden</span>}
                </span>
                <HideButton category={c} />
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`Change ${c.label}`}
                  onClick={() => setEditing(c)}
                  className="h-10 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setEditing(null)}
          className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
        >
          + Add category
        </button>
      </section>

      <section aria-label="Built-in categories" className="flex flex-col gap-2">
        <h2 className="text-[13px] font-extrabold text-muted">BUILT-IN</h2>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {builtIn.map((c) => (
            <li
              key={c.key}
              className="flex flex-col items-center gap-1 rounded-2xl bg-card px-1 py-2 text-xs font-extrabold"
            >
              <Swatch icon={c.icon} tint={c.tint} />
              <span className="max-w-full truncate">{c.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Swatch({ icon, tint }: { icon: string; tint: string }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tint}`}>
      <PathIcon d={icon} size={19} />
    </span>
  );
}

function HideButton({ category }: { category: UserCategory }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setCategoryHidden(category.id, !category.hidden);
        })
      }
      className="h-10 rounded-full px-3 text-sm font-extrabold text-muted hover:bg-mint disabled:opacity-60"
    >
      {category.hidden ? "Show" : "Hide"}
    </button>
  );
}

function CategoryForm({
  kind,
  category,
  onDone,
}: {
  kind: Kind;
  category: UserCategory | null;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(category?.label ?? "");
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICONS[0].icon);
  const [tint, setTint] = useState(category?.tint ?? CATEGORY_TINTS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = { type: category?.type ?? kind, label, icon, tint };
    startTransition(async () => {
      const result = category ? await updateCategory(category.id, input) : await addCategory(input);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Swatch icon={icon} tint={tint} />
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="category-name" className="text-sm font-bold">
            Name
          </label>
          <input
            id="category-name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={CATEGORY_LABEL_MAX}
            placeholder={kind === "expense" ? "Milk tea" : "Tutoring"}
            required
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="category-icon-label" className="text-sm font-bold">
          Icon
        </span>
        <div
          role="group"
          aria-labelledby="category-icon-label"
          className="grid grid-cols-6 gap-1.5"
        >
          {CATEGORY_ICONS.map((i) => (
            <button
              key={i.name + i.icon}
              type="button"
              aria-pressed={icon === i.icon}
              aria-label={i.name}
              onClick={() => setIcon(i.icon)}
              className={`flex h-11 items-center justify-center rounded-xl border-2 ${icon === i.icon ? "border-sea bg-sea-tint" : "border-transparent bg-mint"}`}
            >
              <PathIcon d={i.icon} size={19} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="category-tint-label" className="text-sm font-bold">
          Colour
        </span>
        <div role="group" aria-labelledby="category-tint-label" className="flex flex-wrap gap-2">
          {CATEGORY_TINTS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tint === t}
              aria-label={t.replace(/^bg-|-tint$/g, "").replace("-", " ")}
              onClick={() => setTint(t)}
              className={`h-10 w-10 rounded-xl border-2 ${t} ${tint === t ? "border-sea" : "border-line"}`}
            />
          ))}
        </div>
      </div>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-[16px] bg-sun font-extrabold text-ink disabled:opacity-60"
      >
        {pending ? "Saving…" : category ? "Save" : "Add category"}
      </button>
    </form>
  );
}

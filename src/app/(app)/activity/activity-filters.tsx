"use client";

import { useRouter } from "next/navigation";
import { FIELD_CLASS } from "@/components/choice-chip";

export type CategoryOption = { key: string; label: string; group: "Expense" | "Income" };

/**
 * Category and subcategory filters for Activity. Picking one goes straight to
 * the filtered list (back to page 1); a new category clears the subcategory.
 */
export function ActivityFilters({
  categories,
  subcategories,
  category,
  subcategory,
  query,
}: {
  categories: CategoryOption[];
  /** Used in the picked category this period, most used first. */
  subcategories: string[];
  category: string;
  subcategory: string;
  /** The rest of the URL to keep: period, span and search. */
  query: Record<string, string>;
}) {
  const router = useRouter();
  const go = (c: string, sub: string) => {
    const params = new URLSearchParams(query);
    if (c) params.set("c", c);
    if (c && sub) params.set("sub", sub);
    router.push(`/activity?${params}`);
  };
  const groups = (["Expense", "Income"] as const)
    .map((group) => ({ group, items: categories.filter((c) => c.group === group) }))
    .filter((g) => g.items.length);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="activity-category" className="text-xs font-bold text-muted">
          Category
        </label>
        <select
          id="activity-category"
          value={category}
          onChange={(e) => go(e.target.value, "")}
          className={FIELD_CLASS}
        >
          <option value="">All categories</option>
          {groups.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="activity-subcategory" className="text-xs font-bold text-muted">
          Subcategory
        </label>
        <select
          id="activity-subcategory"
          value={subcategory}
          disabled={!category || (!subcategories.length && !subcategory)}
          onChange={(e) => go(category, e.target.value)}
          className={`${FIELD_CLASS} disabled:opacity-60`}
        >
          <option value="">{category ? "All" : "Pick a category"}</option>
          {subcategories.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

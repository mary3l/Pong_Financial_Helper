"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import {
  CATEGORY_ICONS,
  CATEGORY_LABEL_MAX,
  CATEGORY_TINTS,
  categoriesFor,
  categoryKey,
} from "@/lib/categories";

// Settings › Categories: your own categories beside the built-in ones. See
// 0027_user_categories.sql.

export type CategoryResult = { error?: string; key?: string };

export type CategoryInput = {
  type: "expense" | "income";
  label: string;
  icon: string;
  tint: string;
};

const FAILED = { error: "Couldn't save that. Please try again." };
const MISSING = {
  error: "To add your own categories, run step 27 in supabase/SQL_GUIDE.md first.",
};

const missingTable = (error: { code?: string } | null) =>
  error?.code === "42P01" || error?.code === "PGRST205";

/** The tidied name, or what's wrong. Built-in names are taken: Food is already Food. */
function check(input: CategoryInput): { label: string } | string {
  if (input.type !== "expense" && input.type !== "income") return "Pick Expense or Income.";
  const label = typeof input.label === "string" ? input.label.replace(/\s+/g, " ").trim() : "";
  if (!label) return "Give it a name, like Milk tea.";
  if (label.length > CATEGORY_LABEL_MAX)
    return `Keep the name to ${CATEGORY_LABEL_MAX} characters.`;
  if (categoriesFor(input.type).some((c) => c.label.toLowerCase() === label.toLowerCase()))
    return `${label} is already a category.`;
  if (!CATEGORY_ICONS.some((i) => i.icon === input.icon)) return "Pick an icon.";
  if (!CATEGORY_TINTS.includes(input.tint)) return "Pick a colour.";
  return { label };
}

/** Adds one of yours. Its key comes from the name, made unique (u_milk_tea, u_milk_tea_2). */
export async function addCategory(input: CategoryInput): Promise<CategoryResult> {
  const checked = check(input);
  if (typeof checked === "string") return { error: checked };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data: existing, error: readError } = await supabase
    .from("user_categories")
    .select("key, label, type");
  if (missingTable(readError)) return MISSING;
  if (readError) return FAILED;
  if (
    (existing ?? []).some(
      (c) => c.type === input.type && String(c.label).toLowerCase() === checked.label.toLowerCase(),
    )
  )
    return { error: `${checked.label} is already a category.` };
  const taken = new Set((existing ?? []).map((c) => c.key as string));
  const base = categoryKey(checked.label);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 33)}_${n}`;

  const { error } = await supabase.from("user_categories").insert({
    type: input.type,
    key,
    label: checked.label,
    icon: input.icon,
    tint: input.tint,
  });
  if (missingTable(error)) return MISSING;
  if (error) return FAILED;
  refresh();
  return { key };
}

/** Renames one of yours or changes its icon or colour. Entries follow: they keep its key. */
export async function updateCategory(id: string, input: CategoryInput): Promise<CategoryResult> {
  const checked = check(input);
  if (typeof checked === "string") return { error: checked };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data, error } = await supabase
    .from("user_categories")
    .update({ label: checked.label, icon: input.icon, tint: input.tint })
    .eq("id", id)
    .select("id");
  if (missingTable(error)) return MISSING;
  if (error) return FAILED;
  if (!data.length) return { error: "Couldn't find that category." };
  refresh();
  return {};
}

/** Hides one of yours from Add and the pickers, or brings it back. Old entries keep it. */
export async function setCategoryHidden(id: string, hidden: boolean): Promise<CategoryResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data, error } = await supabase
    .from("user_categories")
    .update({ hidden: Boolean(hidden) })
    .eq("id", id)
    .select("id");
  if (missingTable(error)) return MISSING;
  if (error) return FAILED;
  if (!data.length) return { error: "Couldn't find that category." };
  refresh();
  return {};
}

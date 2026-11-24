"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { SUBCATEGORY_MAX, cleanSubcategory, couldBeCategory } from "@/lib/categories";
import { addDays, isValidDate, today } from "@/lib/dates";
import { MAX_AMOUNT, roundCents } from "@/lib/money";
import { knownCategory } from "@/lib/server-writes";

// Insights › Goals: "Spend under ₱1,500 on Transpo › Grab by Nov 30". See
// 0028_spending_goals.sql.

export type GoalResult = { error?: string };

export type GoalInput = {
  category: string;
  subcategory?: string | null;
  limit: number;
  /** The last day of the goal; it starts today. */
  endsOn: string;
};

const FAILED = { error: "Couldn't save that. Please try again." };
const MISSING = { error: "To save goals, run step 28 in supabase/SQL_GUIDE.md first." };

const missingTable = (error: { code?: string } | null) =>
  error?.code === "42P01" || error?.code === "PGRST205";

/** Adds a goal starting today. */
export async function saveGoal(input: GoalInput): Promise<GoalResult> {
  if (!couldBeCategory("expense", input.category)) return { error: "Pick a category." };
  const subcategory = cleanSubcategory(input.subcategory);
  if (subcategory && subcategory.length > SUBCATEGORY_MAX)
    return { error: `Keep the subcategory to ${SUBCATEGORY_MAX} characters.` };
  const limit = roundCents(Number(input.limit));
  if (!(limit > 0 && limit <= MAX_AMOUNT)) return { error: "Enter an amount above ₱0." };
  const start = today();
  if (!isValidDate(input.endsOn) || input.endsOn < start)
    return { error: "Pick an end date from today on." };
  if (input.endsOn > addDays(start, 366)) return { error: "Keep a goal to a year or less." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await knownCategory(supabase, "expense", input.category)))
    return { error: "Pick a category." };

  const { error } = await supabase.from("spending_goals").insert({
    category: input.category,
    subcategory,
    limit_amount: limit,
    starts_on: start,
    ends_on: input.endsOn,
  });
  if (missingTable(error)) return MISSING;
  if (error) return FAILED;

  refresh();
  return {};
}

export async function removeGoal(id: string): Promise<GoalResult> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    return { error: "Couldn't remove that goal. Please try again." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data, error } = await supabase.from("spending_goals").delete().eq("id", id).select("id");
  if (missingTable(error)) return MISSING;
  if (error || !data.length) return { error: "Couldn't remove that goal. Please try again." };

  refresh();
  return {};
}

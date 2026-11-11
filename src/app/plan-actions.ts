"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { EXPENSE_CATEGORIES, isCategoryFor } from "@/lib/categories";
import { isValidDate, today } from "@/lib/dates";
import { monthlyDates, recurringCategory, splitAmount } from "@/lib/forecast";
import { MAX_AMOUNT, roundCents } from "@/lib/money";
import { pickWallet, type Client } from "@/lib/server-writes";

export type PlanResult = { error?: string };

const FAILED = { error: "Couldn't save that. Please try again." };

async function logTransaction(
  supabase: Client,
  {
    type,
    amount,
    accountId,
    category,
    note,
  }: { type: "expense" | "income"; amount: number; accountId: string; category: string; note: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("transactions")
    .insert({ type, amount, account_id: accountId, category, note, occurred_on: today() })
    .select("id")
    .single();
  return error ? null : data.id;
}

const NO_WALLET = { error: "Add a wallet first, so I know where the money goes." };
const PICK_WALLET = { error: "Pick a cash, bank or e-wallet." };

/**
 * "Mark paid" for a bill, or "Add income" for a payday or recurring income:
 * logs the transaction today and links it to the scheduled date. Undo
 * deletes that transaction, which un-marks the occurrence. `walletId` is the
 * wallet picked for it; without one, the item's own wallet. `amount` is what
 * actually came in or went out (a payday's real pay, a bill that varies);
 * without one, the item's saved amount.
 */
export async function logRecurring(
  recurringItemId: string,
  dueOn: string,
  walletId?: string,
  amount?: number,
): Promise<PlanResult> {
  if (!isValidDate(dueOn)) return FAILED;
  if (amount !== undefined && !(Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT)) {
    return { error: "Enter an amount." };
  }
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data: item } = await supabase
    .from("recurring_items")
    .select("kind, name, amount, account_id, category")
    .eq("id", recurringItemId)
    .maybeSingle();
  if (!item) return { error: "Couldn't find that item." };
  if (!item.amount && amount === undefined) return { error: "Set an amount for it first." };

  const accountId = await pickWallet(supabase, item.account_id, walletId);
  if (!accountId) return walletId ? PICK_WALLET : NO_WALLET;

  const txnId = await logTransaction(supabase, {
    type: item.kind === "bill" ? "expense" : "income",
    amount: amount !== undefined ? roundCents(amount) : Number(item.amount),
    accountId,
    category: recurringCategory(item),
    note: item.kind === "payday" ? "Payday" : item.name,
  });
  if (!txnId) return FAILED;

  const { error } = await supabase
    .from("bill_payments")
    .insert({ recurring_item_id: recurringItemId, due_on: dueOn, transaction_id: txnId });
  if (error) {
    // Already logged (another tab?): don't leave a second transaction behind.
    await supabase.from("transactions").delete().eq("id", txnId);
    if (error.code !== "23505") return FAILED;
  }

  refresh();
  return {};
}

/** "Mark paid" or "Add income" for a planned item: logs it today and links the two. */
export async function logPlanned(id: string, walletId?: string): Promise<PlanResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data: planned } = await supabase
    .from("planned_expenses")
    .select("type, name, amount, category, account_id, transaction_id")
    .eq("id", id)
    .maybeSingle();
  if (!planned) return { error: "Couldn't find that planned item." };
  if (planned.transaction_id) {
    refresh();
    return {};
  }

  const accountId = await pickWallet(supabase, planned.account_id, walletId);
  if (!accountId) return walletId ? PICK_WALLET : NO_WALLET;

  const txnId = await logTransaction(supabase, {
    type: planned.type === "income" ? "income" : "expense",
    amount: Number(planned.amount),
    accountId,
    category: planned.category,
    note: planned.name,
  });
  if (!txnId) return FAILED;

  const { error } = await supabase
    .from("planned_expenses")
    .update({ transaction_id: txnId })
    .eq("id", id)
    .is("transaction_id", null);
  if (error) {
    await supabase.from("transactions").delete().eq("id", txnId);
    return FAILED;
  }

  refresh();
  return {};
}

export type PlannedInput = {
  name: string;
  amount: number;
  category: string;
  /** The date of the first (or only) payment. */
  first: string;
  /** 1 for one-time; more splits it into monthly payments. */
  months: number;
  /** The wallet it'll be paid from; null or missing for any. Mark paid starts on it. */
  accountId?: string | null;
};

/** "Add as planned expense" from Can I afford this?. */
export async function addPlannedExpense(input: PlannedInput): Promise<PlanResult> {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim() || "Planned purchase";
  const amount = roundCents(Number(input.amount));
  if (name.length > 50) return { error: "Keep the name to 50 characters." };
  if (!(amount > 0 && amount <= MAX_AMOUNT)) return { error: "Enter an amount above ₱0." };
  if (!isCategoryFor("expense", input.category)) return { error: "Pick a category." };
  if (!isValidDate(input.first) || input.first < today()) return { error: "Pick today or a later date." };
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 24) {
    return { error: "Pick how many months." };
  }

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  // Only a peso wallet of yours: pickWallet says null for anything else.
  const accountId = input.accountId ? await pickWallet(supabase, null, input.accountId) : null;
  if (input.accountId && !accountId) return { error: "Pick one of your wallets." };

  const amounts = splitAmount(amount, input.months);
  const rows = monthlyDates(input.first, input.months).map((date, i) => ({
    name: input.months > 1 ? `${name} (${i + 1} of ${input.months})` : name,
    amount: amounts[i],
    category: input.category,
    due_on: date,
    account_id: accountId,
  }));
  const { error } = await supabase.from("planned_expenses").insert(rows);
  if (error) return FAILED;

  refresh();
  return {};
}

/** Sets the budget per kinsenas for an expense category. */
export async function saveBudget(category: string, amount: number): Promise<PlanResult> {
  if (!EXPENSE_CATEGORIES.some((c) => c.key === category)) return { error: "Pick a category." };
  const value = roundCents(Number(amount));
  if (!(value > 0 && value <= MAX_AMOUNT)) return { error: "Enter an amount above ₱0." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { error } = await supabase
    .from("budgets")
    .upsert({ category, amount: value }, { onConflict: "user_id,category" });
  if (error) return FAILED;

  refresh();
  return {};
}

export async function removeBudget(id: string): Promise<PlanResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data, error } = await supabase.from("budgets").delete().eq("id", id).select("id");
  if (error || !data.length) return { error: "Couldn't remove that budget. Please try again." };

  refresh();
  return {};
}

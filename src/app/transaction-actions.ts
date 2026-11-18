"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { ADJUSTMENT, SUBCATEGORY_MAX, cleanSubcategory, isCategoryFor } from "@/lib/categories";
import { isValidClock, isValidDate } from "@/lib/dates";
import { bnplFee, buildSchedule } from "@/lib/installments";
import {
  MAX_AMOUNT,
  isSpendable,
  roundCents,
  type AccountType,
  type TransactionType,
} from "@/lib/money";
import { savePlan, type Client } from "@/lib/server-writes";

export type TransactionInput = {
  type: TransactionType;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  /** A transfer between a peso and a dollar wallet: what landed, in the destination's currency. */
  toAmount?: number | null;
  category: string | null;
  /** Typed in Add, like "Jeep" under Transpo. Empty for none. */
  subcategory?: string | null;
  note: string;
  occurredOn: string;
  /** "15:42", or empty to leave it out (the row then shows when it was logged). */
  occurredTime?: string | null;
};

export type ActionResult = { error?: string };

const NOTE_MAX = 120;

function validate(input: TransactionInput) {
  const { type, accountId, occurredOn } = input;
  if (type !== "expense" && type !== "income" && type !== "transfer") {
    return { error: "Pick Expense, Income or Transfer." };
  }
  const amount = roundCents(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount above 0." };
  if (amount > MAX_AMOUNT) return { error: "That amount is too big." };
  const toAmount =
    type === "transfer" && input.toAmount != null ? roundCents(Number(input.toAmount)) : null;
  if (toAmount !== null && !(Number.isFinite(toAmount) && toAmount > 0 && toAmount <= MAX_AMOUNT)) {
    return { error: "Check how much landed." };
  }
  if (typeof accountId !== "string" || !accountId) {
    return { error: type === "income" ? "Pick where the money went." : "Pick a wallet." };
  }
  const toAccountId = type === "transfer" ? input.toAccountId : null;
  if (type === "transfer" && !toAccountId) return { error: "Pick where the money goes." };
  if (toAccountId === accountId) return { error: "Pick two different wallets." };
  const category = type === "transfer" ? null : input.category;
  if (category !== null && !isCategoryFor(type, category)) return { error: "Pick a category." };
  if (type === "expense" && !category) return { error: "Pick a category." };
  const subcategory = category ? cleanSubcategory(input.subcategory) : null;
  if (subcategory && subcategory.length > SUBCATEGORY_MAX) {
    return { error: `Keep the subcategory to ${SUBCATEGORY_MAX} characters.` };
  }
  if (!isValidDate(occurredOn)) return { error: "Pick a date." };
  const occurredTime = input.occurredTime || null;
  if (occurredTime !== null && !isValidClock(occurredTime)) return { error: "Check the time." };
  const note = String(input.note ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > NOTE_MAX) return { error: `Keep the note to ${NOTE_MAX} characters.` };

  return {
    row: {
      type,
      amount,
      account_id: accountId,
      to_account_id: toAccountId,
      // Only between pesos and dollars, so other saves work before migration 0017.
      ...(toAmount !== null && { to_amount: toAmount }),
      category,
      subcategory,
      note: note || null,
      occurred_on: occurredOn,
      occurred_time: occurredTime,
    },
  };
}

type TxnRowInput = NonNullable<ReturnType<typeof validate>["row"]>;

/** Columns newer migrations add: subcategory (0015) and occurred_time (0014). */
const NEWER_COLUMNS = ["subcategory", "occurred_time"] as const;

/** What a save that the currency check (migration 0017) turned down says. */
function currencyError(error: { code?: string; message?: string } | null): string | null {
  if (error?.code === "PGRST204" && error.message?.includes("to_amount")) {
    return "To move money to or from a dollar wallet, run step 17 in supabase/SQL_GUIDE.md first.";
  }
  if (error?.code !== "23514") return null;
  if (error.message?.includes("pesos and dollars"))
    return "Type how much landed in the other wallet.";
  if (error.message?.includes("Dollar wallets"))
    return "Dollar wallets only move money by transfer. Pick a peso wallet.";
  return null;
}

/** The column a save failed on because its migration hasn't been run: PostgREST says PGRST204 (or 42703). */
function missingColumn(error: { code?: string; message?: string } | null) {
  if (!error || (error.code !== "PGRST204" && error.code !== "42703")) return null;
  return NEWER_COLUMNS.find((c) => error.message?.includes(c)) ?? null;
}

const MISSING_SUBCATEGORY_ERROR =
  "To save subcategories, run step 15 in supabase/SQL_GUIDE.md first. Or clear the subcategory.";

/**
 * Inserts a transaction, or updates `id`, and returns the new row's id.
 * Before migration 0014 it saves again without the time. Before 0015 it
 * does the same without the subcategory, unless one was picked.
 */
async function writeTxn(supabase: Client, row: TxnRowInput, id?: string) {
  const run = (values: Partial<TxnRowInput>) =>
    id
      ? supabase.from("transactions").update(values).eq("id", id).select("id")
      : supabase.from("transactions").insert(values).select("id");
  const values: Partial<TxnRowInput> = { ...row };
  let result = await run(values);
  for (let tries = 0; tries < NEWER_COLUMNS.length; tries++) {
    const column = missingColumn(result.error);
    if (!column || !(column in values)) break;
    if (column === "subcategory" && values.subcategory) {
      return {
        data: null,
        error: { code: "missing_subcategory", message: MISSING_SUBCATEGORY_ERROR },
      };
    }
    delete values[column];
    result = await run(values);
  }
  return result;
}

/**
 * Creates a transaction, or updates it when `id` is given. `link` is
 * "<recurring item id>|<date>" when it logs a scheduled occurrence (Add
 * income for a payday with no amount saved).
 */
export async function saveTransaction(
  input: TransactionInput,
  id?: string,
  link?: string,
): Promise<ActionResult> {
  const checked = validate(input);
  if (!checked.row) return { error: checked.error };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  // RLS and the (account, owner) foreign keys reject other people's rows.
  const { data, error } = await writeTxn(supabase, checked.row, id);
  if (error?.code === "missing_subcategory") return { error: MISSING_SUBCATEGORY_ERROR };
  const currency = currencyError(error);
  if (currency) return { error: currency };
  if (error || !data?.length) {
    return { error: "Couldn't save that. Please try again." };
  }

  if (link && !id) {
    const [itemId, dueOn] = link.split("|");
    const linked = isValidDate(dueOn)
      ? await supabase
          .from("bill_payments")
          .insert({ recurring_item_id: itemId, due_on: dueOn, transaction_id: data[0].id })
      : { error: { code: "invalid" } };
    if (linked.error) {
      // Logged already (another tab?): don't count it twice.
      await supabase.from("transactions").delete().eq("id", data[0].id);
      return {
        error:
          linked.error.code === "23505"
            ? "That's already logged."
            : "Couldn't save that. Please try again.",
      };
    }
  }

  // Pesos into dollars: the dollar wallet's rate becomes what you paid on average.
  const row = checked.row;
  if (!id && row.to_account_id && row.to_amount) {
    await averageRate(supabase, row.to_account_id, row.amount, row.to_amount);
  }

  refresh();
  return {};
}

/**
 * After `pesos` bought `dollars` into a dollar wallet, sets its rate (what
 * you got US$1 for) to the average over everything in it, so the gain on the
 * dashboard stays right. Best effort: the transfer is saved either way.
 */
async function averageRate(supabase: Client, accountId: string, pesos: number, dollars: number) {
  const [account, current] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", accountId).maybeSingle(),
    supabase.from("account_balances").select("balance").eq("account_id", accountId).maybeSingle(),
  ]);
  if (!account.data || account.data.currency !== "USD" || !current.data) return;
  const after = Number(current.data.balance);
  const before = after - dollars;
  const old = Number(account.data.fx_rate);
  const rate =
    before > 0 && old > 0 && after > 0 ? (before * old + pesos) / after : pesos / dollars;
  if (!(Number.isFinite(rate) && rate > 0 && rate <= 1000)) return;
  await supabase
    .from("accounts")
    .update({ fx_rate: Math.round(rate * 10000) / 10000 })
    .eq("id", accountId);
}

export type BnplPlanInput = {
  /** 1 = pay next month in full. */
  months: number;
  /** Fee or interest as a flat % of the price per month. */
  ratePerMonth: number;
  firstDue: string;
  payFromAccountId: string | null;
};

/**
 * A purchase on SPayLater or Atome: the expense on the purchase date from
 * the credit line, plus its payment plan. Deleting the expense later
 * deletes the plan too.
 */
export async function saveBnplPurchase(
  input: TransactionInput,
  plan: BnplPlanInput,
): Promise<ActionResult> {
  const checked = validate(input);
  if (!checked.row) return { error: checked.error };
  if (checked.row.type !== "expense") return { error: "Payment plans are for expenses." };
  if (!Number.isInteger(plan.months) || plan.months < 1 || plan.months > 24)
    return { error: "Pick how many months." };
  if (!(plan.ratePerMonth >= 0 && plan.ratePerMonth <= 10))
    return { error: "Check the monthly fee (0 to 10%)." };
  if (!isValidDate(plan.firstDue) || plan.firstDue < checked.row.occurred_on) {
    return { error: "The first payment can't be before the purchase." };
  }

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const ids = [checked.row.account_id, plan.payFromAccountId].filter((id): id is string =>
    Boolean(id),
  );
  const { data: accounts } = await supabase.from("accounts").select("id, type").in("id", ids);
  const typeOf = (id: string | null) =>
    accounts?.find((a) => a.id === id)?.type as AccountType | undefined;
  if (typeOf(checked.row.account_id) !== "credit_line")
    return { error: "Pick a BNPL credit line to pay with." };
  const payFrom =
    plan.payFromAccountId && isSpendable(typeOf(plan.payFromAccountId)!)
      ? plan.payFromAccountId
      : null;

  const { data: rows, error } = await writeTxn(supabase, checked.row);
  const data = rows?.[0];
  if (error?.code === "missing_subcategory") return { error: MISSING_SUBCATEGORY_ERROR };
  if (error || !data) return { error: "Couldn't save that. Please try again." };

  const amount = checked.row.amount;
  const saved = await savePlan(supabase, {
    kind: "bnpl",
    accountId: checked.row.account_id,
    name: checked.row.note ?? "Purchase",
    principal: amount,
    months: plan.months,
    payFromAccountId: payFrom,
    sourceTxnId: data.id,
    rows: buildSchedule({
      principal: amount,
      feeTotal: bnplFee(amount, plan.ratePerMonth, plan.months),
      months: plan.months,
      firstDue: plan.firstDue,
    }),
  });
  if (!saved) {
    await supabase.from("transactions").delete().eq("id", data.id);
    return { error: "Couldn't save the payment plan. Please try again." };
  }

  refresh();
  return {};
}

export type AdjustmentInput = { occurredOn: string; note: string };

/** The row for a balance adjustment of `change` (up is +), or an error. */
function adjustmentRow(change: number, input: AdjustmentInput) {
  const amount = roundCents(Math.abs(change));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount above ₱0." };
  if (amount > MAX_AMOUNT) return { error: "That amount is too big." };
  if (!isValidDate(input.occurredOn)) return { error: "Pick a date." };
  const note = String(input.note ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > NOTE_MAX) return { error: `Keep the note to ${NOTE_MAX} characters.` };
  return {
    row: {
      type: (change > 0 ? "income" : "expense") as TransactionType,
      amount,
      category: ADJUSTMENT,
      note: note || null,
      occurred_on: input.occurredOn,
    },
  };
}

/**
 * Sets what's really in a wallet now, logged as a balance adjustment for the
 * difference: up (income) or down (expense), never counted as either.
 */
export async function adjustBalance(
  accountId: string,
  actual: number,
  input: AdjustmentInput,
): Promise<ActionResult> {
  if (!Number.isFinite(actual) || Math.abs(actual) > MAX_AMOUNT)
    return { error: "Check the amount." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const [account, current] = await Promise.all([
    supabase.from("accounts").select("type, archived").eq("id", accountId).maybeSingle(),
    supabase.from("account_balances").select("balance").eq("account_id", accountId).maybeSingle(),
  ]);
  if (account.error || current.error || !account.data || !current.data)
    return { error: "Couldn't find that wallet." };
  if (!isSpendable(account.data.type as AccountType) || account.data.archived) {
    return { error: "Only cash, bank and e-wallet balances can be adjusted." };
  }

  const change = roundCents(roundCents(actual) - Number(current.data.balance));
  if (change === 0) return { error: "That's already what's in it." };
  const checked = adjustmentRow(change, input);
  if (!checked.row) return { error: checked.error };

  const { error } = await supabase
    .from("transactions")
    .insert({ ...checked.row, account_id: accountId })
    .select("id");
  if (error) return { error: "Couldn't save that. Please try again." };

  refresh();
  return {};
}

/** Changes a balance adjustment: how much it moved the balance (up is +), its date and note. */
export async function updateAdjustment(
  id: string,
  change: number,
  input: AdjustmentInput,
): Promise<ActionResult> {
  const checked = adjustmentRow(roundCents(Number(change)), input);
  if (!checked.row) return { error: checked.error };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  // Only ever turns an adjustment into another adjustment.
  const { data, error } = await supabase
    .from("transactions")
    .update(checked.row)
    .eq("id", id)
    .eq("category", ADJUSTMENT)
    .neq("type", "transfer")
    .select("id");
  if (error || !data?.length) return { error: "Couldn't save that. Please try again." };

  refresh();
  return {};
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data, error } = await supabase.from("transactions").delete().eq("id", id).select("id");
  if (error || !data?.length) {
    return { error: "Couldn't delete that. Please try again." };
  }

  refresh();
  return {};
}

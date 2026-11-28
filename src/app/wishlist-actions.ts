"use server";

import { refresh } from "next/cache";
import { addPlannedExpense } from "@/app/plan-actions";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { couldBeCategory } from "@/lib/categories";
import { isValidDate, today } from "@/lib/dates";
import { MAX_AMOUNT, countsAsSpending, isSpendable, roundCents } from "@/lib/money";
import type { AccountType, WalletPurpose } from "@/lib/money";
import { dropPlanPayments, type Client } from "@/lib/server-writes";
import { MAX_PARTS, MAX_SET_ASIDES, type Strategy } from "@/lib/wishlist";

// Plan › Wishlist: plans Pong picks the date and way to pay for. See
// 0029_wishlist.sql and src/lib/wishlist.ts.

export type WishActionResult = { error?: string };

export type WishInput = {
  name: string;
  amount: number;
  category: string;
  earliest: string;
  /** Null: up to a year on. */
  by: string | null;
  /** If it goes on a card or BNPL: % a month, 0 to 10. */
  feeRate: number;
};

const FAILED = { error: "Couldn't save that. Please try again." };
const MISSING = {
  error: "To use your wishlist, run step 29 in supabase/SQL_GUIDE.md first.",
};

const missingTable = (error: { code?: string } | null) =>
  error?.code === "42P01" || error?.code === "PGRST205";

/** The plan as a row, or an error to show. */
function checked(input: WishInput): { row: Record<string, unknown> } | { error: string } {
  const name = String(input.name ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const amount = roundCents(Number(input.amount));
  const feeRate = Number(input.feeRate ?? 0);
  if (!name) return { error: "What is it? Give it a name." };
  if (name.length > 50) return { error: "Keep the name to 50 characters." };
  if (!(amount > 0 && amount <= MAX_AMOUNT)) return { error: "Enter an amount above ₱0." };
  if (!couldBeCategory("expense", input.category)) return { error: "Pick a category." };
  if (!isValidDate(input.earliest)) return { error: "Pick the save from date." };
  if (input.by !== null && (!isValidDate(input.by) || input.by < input.earliest))
    return { error: 'The "ready by" date has to be on or after the "save from" date.' };
  if (!(feeRate >= 0 && feeRate <= 10)) return { error: "Check the monthly fee (0 to 10%)." };
  return {
    row: {
      name,
      amount,
      category: input.category,
      earliest: input.earliest,
      by_date: input.by,
      fee_rate: feeRate,
    },
  };
}

/** Adds a plan, or changes one (`id`). Changing a plan you made real makes it an idea again. */
export async function saveWish(input: WishInput, id?: string): Promise<WishActionResult> {
  const result = checked(input);
  if ("error" in result) return result;

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data, error } = id
    ? await supabase
        .from("wishlist_items")
        .update({ ...result.row, status: "idea" })
        .eq("id", id)
        .select("id")
    : await supabase.from("wishlist_items").insert(result.row).select("id");
  if (missingTable(error)) return MISSING;
  if (error || !data?.length) return FAILED;

  refresh();
  return {};
}

/** Removes a plan, and its unpaid payments in Scheduled if you made it real. */
export async function removeWish(id: string): Promise<WishActionResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await dropPlanPayments(supabase, id)))
    return { error: "Couldn't remove its payments. Please try again." };
  const { data, error } = await supabase.from("wishlist_items").delete().eq("id", id).select("id");
  if (missingTable(error)) return MISSING;
  if (error || !data?.length) return { error: "Couldn't remove that plan. Please try again." };

  refresh();
  return {};
}

/**
 * Change plan: takes a plan you made real out of Scheduled (its unpaid
 * payments) and makes it an idea again, to edit or pick another way.
 */
export async function reopenWish(id: string): Promise<WishActionResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await dropPlanPayments(supabase, id)))
    return { error: "Couldn't take its payments out of Scheduled. Please try again." };
  const { data, error } = await supabase
    .from("wishlist_items")
    .update({ status: "idea" })
    .eq("id", id)
    .select("id");
  if (missingTable(error)) return MISSING;
  if (error || !data?.length) return FAILED;

  refresh();
  return {};
}

const MONTHS = new Set([1, 3, 6, 12]);

/** A way to pay sent from the browser, checked. */
function validStrategy(s: Strategy | null | undefined): s is Strategy {
  if (!s || typeof s !== "object") return false;
  if (s.kind === "full" || s.kind === "save") return true;
  // Parts from your wallets: as many months as fit between the dates.
  if (s.kind === "installments")
    return Number.isInteger(s.months) && s.months > 1 && s.months <= MAX_PARTS;
  if (s.kind === "credit") return MONTHS.has(s.months) && typeof s.lineId === "string";
  return false;
}

/**
 * Make it real: saves the way to pay you picked as planned expenses, the same
 * as Can I afford this? (bills on a card's due days with the plan's fee), and
 * marks the plan 'scheduled'. From then on it's in your forecast, so your
 * other plans are checked with it.
 */
export async function makeWishReal(
  id: string,
  choice: {
    date: string;
    strategy: Strategy;
    /** Saving up: each set-aside, as Pong worked them out. */
    payments?: { dueOn: string; amount: number }[];
    /** Saving up: the savings wallet they go into. */
    toAccountId?: string;
  },
): Promise<WishActionResult> {
  if (!isValidDate(choice?.date)) return { error: "Pick a date." };
  if (!validStrategy(choice.strategy)) return { error: "Pick a way to pay." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data: wish, error } = await supabase
    .from("wishlist_items")
    .select("id, name, amount, category, fee_rate, status")
    .eq("id", id)
    .maybeSingle();
  if (missingTable(error)) return MISSING;
  if (error) return FAILED;
  if (!wish) return { error: "That plan is gone. Refresh and try again." };
  if (wish.status === "scheduled") return { error: "That plan is already in Scheduled." };

  const s = choice.strategy;
  if (s.kind === "save") {
    const problem = await saveSetAsides(supabase, wish, choice.payments, choice.toAccountId);
    if (problem) return problem;
  }
  const saved =
    s.kind === "save"
      ? {}
      : await addPlannedExpense({
          name: wish.name,
          amount: Number(wish.amount),
          category: wish.category,
          first: choice.date,
          months: s.kind === "full" ? 1 : s.months,
          credit:
            s.kind === "credit" ? { lineId: s.lineId, ratePerMonth: Number(wish.fee_rate) } : null,
          wishId: wish.id,
        });
  if (saved.error) return saved;

  const { error: marked } = await supabase
    .from("wishlist_items")
    .update({ status: "scheduled" })
    .eq("id", id);
  if (marked)
    return { error: "It's in Scheduled, but I couldn't mark the plan. Refresh to see it." };

  refresh();
  return {};
}

const MISSING_SET_ASIDES = {
  error: "To save up for a plan, run step 31 in supabase/SQL_GUIDE.md first.",
};

/**
 * Saving up: one set-aside per payday into the savings wallet, linked to the
 * plan. The dates and amounts come from the browser, so they're checked: in
 * order, from today on, adding up to the plan. An error, or null when saved.
 */
async function saveSetAsides(
  supabase: Client,
  wish: { id: string; name: string; amount: number | string; category: string },
  payments: { dueOn: string; amount: number }[] | undefined,
  toAccountId: string | undefined,
): Promise<WishActionResult | null> {
  const list = Array.isArray(payments) ? payments : [];
  const total = roundCents(list.reduce((sum, p) => sum + Number(p?.amount), 0));
  const inOrder = list.every(
    (p, i) =>
      isValidDate(p?.dueOn) &&
      p.dueOn >= today() &&
      Number(p.amount) > 0 &&
      roundCents(Number(p.amount)) === Number(p.amount) &&
      (i === 0 || p.dueOn > list[i - 1].dueOn),
  );
  if (!list.length || list.length > MAX_SET_ASIDES || !inOrder || total !== Number(wish.amount))
    return { error: "Those set-asides don't add up. Refresh and try again." };

  const { data: wallet } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", toAccountId ?? "")
    .eq("archived", false)
    .maybeSingle();
  const savings =
    wallet &&
    isSpendable(wallet.type as AccountType) &&
    !countsAsSpending(wallet as { type: AccountType; purpose: WalletPurpose }) &&
    wallet.currency !== "USD";
  if (!savings) return { error: "Pick one of your savings wallets." };

  const n = list.length;
  const { error } = await supabase.from("planned_expenses").insert(
    list.map((p, i) => {
      const suffix = n > 1 ? ` · set aside (${i + 1} of ${n})` : " · set aside";
      return {
        type: "set_aside",
        name: wish.name.slice(0, 60 - suffix.length).trim() + suffix,
        amount: Number(p.amount),
        category: wish.category,
        due_on: p.dueOn,
        account_id: null,
        to_account_id: wallet.id,
        wish_id: wish.id,
      };
    }),
  );
  // 23514: the type isn't allowed yet; 42703: no to_account_id yet. Both mean step 31.
  if (error?.code === "23514" || error?.code === "42703") return MISSING_SET_ASIDES;
  if (error) return FAILED;
  return null;
}

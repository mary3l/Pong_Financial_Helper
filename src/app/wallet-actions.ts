"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { addDays, isValidDate, today } from "@/lib/dates";
import { GOAL_MAX_YEARS } from "@/lib/goals";
import {
  MAX_AMOUNT,
  canEarnInterest,
  isCurrency,
  isInterestPayout,
  isWalletPurpose,
  isWalletType,
  roundCents,
  type Currency,
  type InterestPayout,
  type WalletPurpose,
  type WalletType,
} from "@/lib/money";

export type WalletInput = {
  name: string;
  type: WalletType;
  balance: number;
  /** Left out by first-run setup: new wallets are spending money. */
  purpose?: WalletPurpose;
  /** % a year, banks and e-wallets only; null for none. */
  interestRate?: number | null;
  /** When the bank credits the interest: daily (MariBank) or on the 1st (GoTyme). */
  interestPayout?: InterestPayout;
  /** A savings target, like a GoTyme GoalSave; null for none. */
  goalAmount?: number | null;
  /** The goal's deadline; null for none. Needs a goal amount. */
  goalDate?: string | null;
  /** Set when adding a wallet; a wallet keeps its currency. Left out for pesos. */
  currency?: Currency;
  /** USD wallets: pesos per US$1. */
  fxRate?: number | null;
  /** Time deposits (interest paid when it matures): the day it matures. */
  maturesOn?: string | null;
  /** Time deposits: the day the money went in, when interest starts. */
  placedOn?: string | null;
};
export type WalletResult = { error?: string; archived?: boolean };

const NAME_MAX = 60;

/**
 * A save that failed because a column's migration hasn't been run: the
 * purpose and interest columns (0010), the payout (0011) or the goal (0016).
 * PostgREST says PGRST204 for a column it doesn't know, Postgres 42703.
 */
function needsMigration(error: { code?: string; message?: string } | null): string | null {
  if (!error || (error.code !== "PGRST204" && error.code !== "42703" && error.code !== "23514"))
    return null;
  if (/currency|fx_rate|matures_on|interest_payout_check/.test(error.message ?? "")) {
    return "For dollar wallets and time deposits, run step 17 in supabase/SQL_GUIDE.md first.";
  }
  if (error.code === "23514") return null;
  if (error.message?.includes("goal_")) {
    return "To save a goal, run step 16 in supabase/SQL_GUIDE.md first. Or clear the goal.";
  }
  return "Run steps 10 and 11 in supabase/SQL_GUIDE.md first, then try again.";
}

function cleanName(name: unknown) {
  return String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pesos per US$1 a rate can be, so a typo like 5800 is caught. */
const FX_MAX = 1000;

function checkWallet(w: WalletInput, currency: Currency = w.currency ?? "PHP"): string | null {
  const name = cleanName(w.name);
  if (!name) return "Give each wallet a name.";
  if (name.length > NAME_MAX) return `Keep wallet names to ${NAME_MAX} characters.`;
  if (!isWalletType(w.type)) return `Pick a type for ${name}.`;
  if (!Number.isFinite(w.balance) || Math.abs(w.balance) > MAX_AMOUNT) {
    return `Check the amount for ${name}.`;
  }
  if (w.purpose !== undefined && !isWalletPurpose(w.purpose)) return `Pick a category for ${name}.`;
  const rate = w.interestRate ?? null;
  if (rate !== null) {
    if (!canEarnInterest(w.type)) return "Only banks and e-wallets earn interest.";
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100)
      return `Check the interest rate for ${name}.`;
  }
  if (w.interestPayout !== undefined && !isInterestPayout(w.interestPayout)) {
    return `Pick when ${name} pays interest.`;
  }
  if (!isCurrency(currency)) return `Pick pesos or dollars for ${name}.`;
  if (currency === "USD") {
    const fx = w.fxRate ?? null;
    if (fx === null || !Number.isFinite(fx) || fx <= 0 || fx > FX_MAX) {
      return `Set how many pesos US$1 is for ${name}, like 58.50.`;
    }
    if (w.purpose === "spending")
      return "Dollars aren't spending money. Pick Savings, Emergency fund or Investments.";
    if (w.goalAmount != null) return "Goals are in pesos, so a dollar wallet can't have one yet.";
  }
  if (w.interestRate != null && w.interestPayout === "maturity") {
    if (!w.maturesOn || !isValidDate(w.maturesOn)) return `Pick when ${name} matures.`;
    if (w.maturesOn > addDays(today(), 10 * 366)) return "Pick a maturity date within 10 years.";
    if (w.placedOn != null) {
      if (!isValidDate(w.placedOn) || w.placedOn > today())
        return `Check when you put the money in ${name}.`;
      if (w.placedOn >= w.maturesOn) return "It has to mature after the day you put the money in.";
    }
  }
  const goal = w.goalAmount ?? null;
  if (goal !== null) {
    if (!Number.isFinite(goal) || goal <= 0 || goal > MAX_AMOUNT)
      return `Check the goal amount for ${name}.`;
  }
  if (w.goalDate != null) {
    if (goal === null) return `Set how much you're saving for before picking a date.`;
    if (!isValidDate(w.goalDate)) return `Check the goal date for ${name}.`;
    if (w.goalDate > addDays(today(), GOAL_MAX_YEARS * 366)) {
      return `Pick a goal date within ${GOAL_MAX_YEARS} years.`;
    }
  }
  return null;
}

/**
 * The purpose, interest and goal columns, only when the form sent them. A
 * daily payout is the column's default, so it's only sent when it changes,
 * and no goal is only sent to clear one: wallets still save before
 * migrations 0011 and 0016.
 */
function extras(w: WalletInput, payoutBefore = "daily", hadGoal = false) {
  const goal = w.goalAmount ?? null;
  return {
    ...(w.purpose !== undefined && { purpose: w.purpose }),
    ...(w.interestRate !== undefined && {
      interest_rate: w.interestRate === null ? null : Math.round(w.interestRate * 100) / 100,
    }),
    ...(w.interestPayout !== undefined &&
      w.interestPayout !== payoutBefore && { interest_payout: w.interestPayout }),
    ...(w.goalAmount !== undefined &&
      (goal !== null || hadGoal) && {
        goal_amount: goal === null ? null : roundCents(goal),
        goal_date: goal === null ? null : (w.goalDate ?? null),
      }),
  };
}

/**
 * Migration 0017's columns, only when they matter: a dollar wallet's rate,
 * and a maturity date (or clearing one). Peso wallets save before 0017.
 */
function currencyColumns(w: WalletInput, currency: Currency, hadMaturity = false) {
  const maturesOn =
    w.interestRate != null && w.interestPayout === "maturity" ? (w.maturesOn ?? null) : null;
  return {
    ...(currency === "USD" && { fx_rate: Math.round((w.fxRate ?? 0) * 10000) / 10000 }),
    ...((maturesOn !== null || hadMaturity) && { matures_on: maturesOn }),
  };
}

/** A time deposit's start, when it has one. */
function placedOn(w: WalletInput): string | null {
  return w.interestRate != null && w.interestPayout === "maturity" ? (w.placedOn ?? null) : null;
}

/** Adds wallets with what's in them right now (onboarding and Money). */
export async function addWallets(wallets: WalletInput[]): Promise<WalletResult> {
  for (const w of wallets) {
    const problem = checkWallet(w);
    if (problem) return { error: problem };
  }
  if (!wallets.length) return {};

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { error } = await supabase.from("accounts").insert(
    wallets.map((w) => ({
      name: cleanName(w.name),
      type: w.type,
      starting_balance: roundCents(w.balance),
      ...extras(w),
      ...(w.currency === "USD" && { currency: "USD" }),
      ...currencyColumns(w, w.currency ?? "PHP"),
      ...(w.interestRate && { interest_since: placedOn(w) ?? today() }),
    })),
  );
  const migration = needsMigration(error);
  if (migration) return { error: migration };
  if (error) return { error: "Couldn't save your wallets. Please try again." };

  refresh();
  return {};
}

/**
 * Renames a wallet and sets what's in it now. The starting balance is
 * adjusted so past transactions stay as they are.
 */
export async function updateWallet(id: string, input: WalletInput): Promise<WalletResult> {
  const { name, type, balance } = input;

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const [account, current] = await Promise.all([
    // "*" so this still works before migration 0010 adds interest_rate.
    supabase.from("accounts").select("*").eq("id", id).maybeSingle(),
    supabase.from("account_balances").select("balance").eq("account_id", id).maybeSingle(),
  ]);
  if (account.error || current.error || !account.data || !current.data) {
    return { error: "Couldn't find that wallet." };
  }
  // A wallet keeps the currency it was added with: its history is in it.
  const currency: Currency = account.data.currency === "USD" ? "USD" : "PHP";
  const problem = checkWallet(input, currency);
  if (problem) return { error: problem };

  const starting = Number(account.data.starting_balance) + (balance - Number(current.data.balance));
  const row = {
    ...extras(input, account.data.interest_payout ?? "daily", account.data.goal_amount != null),
    ...currencyColumns(input, currency, account.data.matures_on != null),
  };
  // A new rate starts a new estimate; without one there's nothing to estimate.
  if ("interest_rate" in row) {
    const before = account.data.interest_rate == null ? null : Number(account.data.interest_rate);
    if (row.interest_rate === null) Object.assign(row, { interest_since: null });
    else if (row.interest_rate !== before)
      Object.assign(row, { interest_since: placedOn(input) ?? today() });
  }
  // A time deposit earns from the day the money went in.
  const placed = placedOn(input);
  if (placed && row.interest_rate !== null) Object.assign(row, { interest_since: placed });
  const { error } = await supabase
    .from("accounts")
    .update({ name: cleanName(name), type, starting_balance: roundCents(starting), ...row })
    .eq("id", id);
  const migration = needsMigration(error);
  if (migration) return { error: migration };
  if (error) return { error: "Couldn't save that wallet. Please try again." };

  refresh();
  return {};
}

/**
 * Deletes a wallet that was never used. One with transactions or bills is
 * archived instead, so its history and balances stay right.
 */
export async function removeWallet(id: string): Promise<WalletResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const deleted = await supabase.from("accounts").delete().eq("id", id).select("id");
  if (!deleted.error && deleted.data.length) {
    refresh();
    return {};
  }
  // 23503: still referenced by a transaction or a bill.
  if (deleted.error?.code !== "23503") {
    return { error: "Couldn't remove that wallet. Please try again." };
  }

  const archived = await setArchived(id, true);
  return archived.error ? archived : { archived: true };
}

export async function restoreWallet(id: string): Promise<WalletResult> {
  return setArchived(id, false);
}

async function setArchived(id: string, archived: boolean): Promise<WalletResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data, error } = await supabase
    .from("accounts")
    .update({ archived })
    .eq("id", id)
    .select("id");
  if (error || !data.length) return { error: "Couldn't update that wallet. Please try again." };

  refresh();
  return {};
}

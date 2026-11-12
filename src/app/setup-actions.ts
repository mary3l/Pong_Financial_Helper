"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { MAX_AMOUNT, roundCents } from "@/lib/money";
import { isValidSchedule, type Schedule } from "@/lib/schedule";

export type BillInput = {
  /** Set for a bill that's already saved. */
  id?: string;
  name: string;
  amount: number;
  /** Day of the month it's due. */
  day: number;
  accountId: string | null;
};

export type PaydayInput = {
  /** Null when pay is irregular. */
  schedule: Schedule | null;
  /** Net pay per payday, if the user shares it. */
  amount: number | null;
  /** The amount is an estimate (the payroll calculator sets this). */
  amountVaries?: boolean;
  accountId: string | null;
  bills: BillInput[];
};

export type SetupResult = { error?: string };

type Client = NonNullable<Awaited<ReturnType<typeof signedInClient>>>;

function validate(input: PaydayInput): string | null {
  if (input.schedule && !isValidSchedule(input.schedule)) return "Check your payday dates.";
  if (input.amount !== null && !(input.amount > 0 && input.amount <= MAX_AMOUNT)) {
    return "Check your net pay, or leave it blank.";
  }
  for (const bill of input.bills) {
    const name = bill.name.trim();
    if (!name) return "Give each bill a name.";
    if (name.length > 60) return "Keep bill names to 60 characters.";
    if (!(bill.amount > 0 && bill.amount <= MAX_AMOUNT)) return `Add an amount for ${name}. A guess is fine.`;
    if (!Number.isInteger(bill.day) || bill.day < 1 || bill.day > 31) return `Pick the day ${name} is due.`;
  }
  return null;
}

/** Saves the payday schedule and the list of monthly bills, then ends setup. */
export async function savePaydayAndBills(input: PaydayInput): Promise<SetupResult> {
  const problem = validate(input);
  if (problem) return { error: problem };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const failed = { error: "Couldn't save that. Please try again." };

  // Paydays that differ (which Fridays pay, an amount per payday) need
  // migration 0022: check before the old payday goes.
  const weeks = input.schedule?.frequency === "weekly" && input.schedule.weeks?.length ? [...input.schedule.weeks] : null;
  const amounts = input.schedule?.amounts?.some((a) => a !== null)
    ? input.schedule.amounts.map((a) => (a === null ? null : roundCents(a)))
    : null;
  const daily = input.schedule?.frequency === "daily";
  const weekdays = daily && input.schedule?.weekdays?.length ? [...input.schedule.weekdays] : null;
  if (daily) {
    const { error } = await supabase.from("recurring_items").select("pay_weekdays").limit(1);
    if (error) return { error: "To get paid every work day, run step 23 in supabase/SQL_GUIDE.md first." };
  }
  if (weeks || amounts) {
    const { error } = await supabase.from("recurring_items").select("pay_weeks, pay_amounts").limit(1);
    if (error) return { error: "To pick paydays or an amount for each one, run step 22 in supabase/SQL_GUIDE.md first." };
  }

  const clearPayday = await supabase.from("recurring_items").delete().eq("kind", "payday");
  if (clearPayday.error) return failed;
  if (input.schedule) {
    const { error } = await supabase.from("recurring_items").insert({
      kind: "payday",
      name: "Payday",
      amount: input.amount === null ? null : roundCents(input.amount),
      amount_varies: Boolean(input.amountVaries),
      account_id: input.accountId,
      frequency: input.schedule.frequency,
      day1: input.schedule.day1,
      day2: input.schedule.day2,
      // Left out when not used, so a payday saves before 0022 too.
      ...(weeks ? { pay_weeks: weeks } : {}),
      ...(weekdays ? { pay_weekdays: weekdays } : {}),
      ...(amounts ? { pay_amounts: amounts } : {}),
    });
    if (error) return failed;
  }

  // Only monthly bills are edited here; Plan › Scheduled handles the rest,
  // and the payroll calculator its own contributions (payroll_key, 0013).
  // "*" so this works before 0013 is run, too.
  const existing = await supabase
    .from("recurring_items")
    .select("*")
    .eq("kind", "bill")
    .eq("frequency", "monthly");
  if (existing.error) return failed;
  const keep = new Set(input.bills.flatMap((b) => (b.id ? [b.id] : [])));
  const removed = existing.data
    .filter((b) => !b.payroll_key)
    .map((b) => b.id)
    .filter((id) => !keep.has(id));
  if (removed.length) {
    const { error } = await supabase.from("recurring_items").delete().in("id", removed);
    if (error) return failed;
  }

  for (const bill of input.bills) {
    const row = {
      kind: "bill",
      name: bill.name.replace(/\s+/g, " ").trim(),
      amount: roundCents(bill.amount),
      account_id: bill.accountId,
      frequency: "monthly",
      day1: bill.day,
      day2: null,
    };
    const { error } = bill.id
      ? await supabase.from("recurring_items").update(row).eq("id", bill.id)
      : await supabase.from("recurring_items").insert(row);
    if (error) return failed;
  }

  return markSetupDone(supabase);
}

/** Skips the rest of setup. Everything can be added later. */
export async function finishSetup(): Promise<SetupResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  return markSetupDone(supabase);
}

async function markSetupDone(supabase: Client): Promise<SetupResult> {
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.user_metadata?.setup_done) {
    const { error } = await supabase.auth.updateUser({ data: { setup_done: true } });
    if (error) return { error: "Couldn't finish setup. Please try again." };
    // The proxy reads this flag from the session token, so refresh it now.
    await supabase.auth.refreshSession();
  }
  refresh();
  return {};
}

"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { isCategoryFor } from "@/lib/categories";
import { isValidDate } from "@/lib/dates";
import { MAX_AMOUNT, roundCents } from "@/lib/money";
import { isValidSchedule, type Frequency } from "@/lib/schedule";

// Recurring and planned income and expenses (Plan › Scheduled). Payday has
// its own screen in setup; everything else you expect lives here. See
// 0004_scheduled_cashflows.sql.

export type ScheduledInput = {
  /** Money coming in (income) or going out (expense). */
  flow: "in" | "out";
  name: string;
  amount: number;
  /** Recurring only: the amount is an estimate, like electricity. */
  amountVaries: boolean;
  category: string;
  accountId: string | null;
  repeat: "once" | Frequency;
  /** The date, for "once". */
  date: string | null;
  /** Weekday 0–6 for weekly, else a day of the month. */
  day1: number;
  /** Second day of the month for twice_monthly. */
  day2: number | null;
  /** Recurring only: last date it can fall on. */
  endsOn: string | null;
};

/** Where a saved item lives: recurring_items or planned_expenses. */
export type ScheduledRef = { table: "recurring" | "planned"; id: string };

export type ScheduleResult = { error?: string };

const FAILED = { error: "Couldn't save that. Please try again." };

function validate(input: ScheduledInput): string | null {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "Give it a name.";
  if (name.length > 60) return "Keep the name to 60 characters.";
  const amount = roundCents(Number(input.amount));
  if (!(amount > 0 && amount <= MAX_AMOUNT)) return "Enter an amount above ₱0.";
  if (input.flow !== "in" && input.flow !== "out") return "Pick income or expense.";
  if (!isCategoryFor(input.flow === "in" ? "income" : "expense", input.category)) return "Pick a category.";
  if (input.repeat === "once") {
    if (!isValidDate(input.date)) return "Pick a date.";
    return null;
  }
  // Every work day is for paydays only.
  if (input.repeat === "daily" || !isValidSchedule({ frequency: input.repeat, day1: input.day1, day2: input.day2 })) {
    return "Check the dates it repeats on.";
  }
  if (input.endsOn !== null && !isValidDate(input.endsOn)) return "Check the end date, or leave it blank.";
  return null;
}

function rowFor(input: ScheduledInput): { table: "planned_expenses" | "recurring_items"; row: Record<string, unknown> } {
  const name = input.name.replace(/\s+/g, " ").trim();
  const amount = roundCents(Number(input.amount));
  if (input.repeat === "once") {
    return {
      table: "planned_expenses",
      row: {
        type: input.flow === "in" ? "income" : "expense",
        name,
        amount,
        category: input.category,
        due_on: input.date!,
        account_id: input.accountId,
      },
    };
  }
  return {
    table: "recurring_items",
    row: {
      kind: input.flow === "in" ? "income" : "bill",
      name,
      amount,
      amount_varies: Boolean(input.amountVaries),
      category: input.category,
      account_id: input.accountId,
      frequency: input.repeat,
      day1: input.day1,
      day2: input.repeat === "twice_monthly" ? input.day2 : null,
      ends_on: input.endsOn,
    },
  };
}

const TABLES = { recurring: "recurring_items", planned: "planned_expenses" } as const;

/**
 * Adds a recurring or one-off item, or updates `existing`. Switching between
 * one-off and recurring moves it to the other table; anything already
 * logged stays in Activity.
 */
export async function saveScheduled(input: ScheduledInput, existing?: ScheduledRef): Promise<ScheduleResult> {
  const problem = validate(input);
  if (problem) return { error: problem };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { table, row } = rowFor(input);
  if (existing && TABLES[existing.table] === table) {
    const { data, error } = await supabase.from(table).update(row).eq("id", existing.id).select("id");
    if (error || !data.length) return FAILED;
  } else {
    const { error } = await supabase.from(table).insert(row);
    if (error) return FAILED;
    if (existing) {
      // Never touch payday from here: it has its own screen.
      let remove = supabase.from(TABLES[existing.table]).delete().eq("id", existing.id);
      if (existing.table === "recurring") remove = remove.neq("kind", "payday");
      await remove;
    }
  }

  refresh();
  return {};
}

export async function removeScheduled({ table, id }: ScheduledRef): Promise<ScheduleResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  let query = supabase.from(TABLES[table]).delete().eq("id", id);
  if (table === "recurring") query = query.neq("kind", "payday");
  const { data, error } = await query.select("id");
  if (error || !data.length) return { error: "Couldn't remove that. Please try again." };

  refresh();
  return {};
}

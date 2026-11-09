"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { readPayroll } from "@/lib/data";
import { isValidDate, periodContaining, today as getToday } from "@/lib/dates";
import { MAX_AMOUNT, roundCents } from "@/lib/money";
import {
  RATES,
  contributions,
  cutoffDates,
  isTime,
  typicalCutoffPay,
  upcomingTaxPayments,
  type ContributionKey,
  type OvertimeEntry,
  type PayrollDay,
  type PayrollSettings,
} from "@/lib/payroll";

// Payroll calculator (Plan › Scheduled › Payroll). Saving your pay or a
// cutoff also updates the payday amount and the SSS, PhilHealth, Pag-IBIG
// and income tax bills in Money going out. See 0013_payroll.sql.

export type PayrollResult = { error?: string };

type Client = NonNullable<Awaited<ReturnType<typeof signedInClient>>>;

const FAILED = { error: "Couldn't save that. Please try again." };
const MISSING = { error: "Run step 13 in supabase/SQL_GUIDE.md first, then try again." };

function validateSettings(s: PayrollSettings): string | null {
  if (!(s.dailyRate > 0 && s.dailyRate <= MAX_AMOUNT)) return "Enter your daily rate.";
  if (!(s.hoursPerDay > 0 && s.hoursPerDay <= 24)) return "Hours per day should be between 1 and 24.";
  if (!isTime(s.startTime)) return "Check your start time.";
  if (!(s.overtimeRate >= 1 && s.overtimeRate <= 5)) return "Overtime rate should be between 1 and 5.";
  if (s.monthlyBase !== null && !(s.monthlyBase > 0 && s.monthlyBase <= MAX_AMOUNT)) {
    return "Check the monthly pay for contributions, or leave it blank.";
  }
  if (s.startedOn !== null && !isValidDate(s.startedOn)) return "Check the date you started, or leave it blank.";
  return null;
}

export async function savePayrollSettings(input: PayrollSettings): Promise<PayrollResult> {
  const problem = validateSettings(input);
  if (problem) return { error: problem };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const row = {
    daily_rate: roundCents(input.dailyRate),
    hours_per_day: Math.round(input.hoursPerDay * 100) / 100,
    start_time: input.startTime,
    overtime_rate: Math.round(input.overtimeRate * 100) / 100,
    monthly_base: input.monthlyBase === null ? null : roundCents(input.monthlyBase),
    started_on: input.startedOn,
    pay_sss: Boolean(input.paySss),
    pay_philhealth: Boolean(input.payPhilhealth),
    pay_pagibig: Boolean(input.payPagibig),
    pay_tax: Boolean(input.payTax),
    updated_at: new Date().toISOString(),
  };
  const existing = await supabase.from("payroll_settings").select("user_id").maybeSingle();
  if (existing.error?.code === "PGRST205") return MISSING;
  if (existing.error) return FAILED;
  const { error } = existing.data
    ? await supabase.from("payroll_settings").update(row).eq("user_id", existing.data.user_id)
    : await supabase.from("payroll_settings").insert(row);
  if (error) return FAILED;

  return sync(supabase);
}

export type ContributionAmounts = Pick<PayrollSettings, "sssAmount" | "philhealthAmount" | "pagibigAmount">;

/**
 * What your company actually takes for SSS, PhilHealth and Pag-IBIG. Null
 * goes back to the calculated amount. Updates the bills in Money going out.
 */
export async function saveContributionAmounts(input: ContributionAmounts): Promise<PayrollResult> {
  const amounts = [input.sssAmount, input.philhealthAmount, input.pagibigAmount];
  if (amounts.some((a) => a !== null && !(typeof a === "number" && a > 0 && a <= MAX_AMOUNT))) {
    return { error: "Enter an amount above ₱0, or leave it blank to use the calculated one." };
  }

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const own = (a: number | null) => (a === null ? null : roundCents(a));
  const { data, error } = await supabase
    .from("payroll_settings")
    .update({
      sss_amount: own(input.sssAmount),
      philhealth_amount: own(input.philhealthAmount),
      pagibig_amount: own(input.pagibigAmount),
      updated_at: new Date().toISOString(),
    })
    .not("user_id", "is", null)
    .select("user_id");
  if (error?.code === "PGRST205") return MISSING;
  // PostgREST says PGRST204 for a column it doesn't know, Postgres 42703.
  if (error?.code === "PGRST204" || error?.code === "42703") {
    return { error: "To use your own amounts, run step 18 in supabase/SQL_GUIDE.md first." };
  }
  if (error) return FAILED;
  if (!data.length) return { error: "Set up your pay first." };

  return sync(supabase);
}

export type CutoffInput = {
  /** The cutoff's first day: the 1st or the 16th. */
  start: string;
  days: PayrollDay[];
  overtime: OvertimeEntry[];
};

function validateCutoff(input: CutoffInput): string | null {
  if (!isValidDate(input.start)) return "Pick a cutoff.";
  const period = periodContaining(input.start);
  if (period.start !== input.start) return "Pick a cutoff.";
  const dates = cutoffDates(period);
  if (input.days.length !== dates.length || input.days.some((d, i) => d.date !== dates[i])) {
    return "Reload the page and try again.";
  }
  for (const d of input.days) {
    if (!["worked", "leave", "off"].includes(d.status)) return "Pick worked, leave or off for each day.";
    if (d.status === "leave" && d.leaveType !== "sick" && d.leaveType !== "personal") {
      return "Pick sick or personal leave for each leave day.";
    }
    if (d.note !== null && (typeof d.note !== "string" || d.note.length > 100)) return "Keep leave reasons to 100 characters.";
    if (d.timeIn !== null && !isTime(d.timeIn)) return "Check your time in.";
  }
  if (input.overtime.length > 60) return "That's a lot of overtime entries. Combine some.";
  for (const o of input.overtime) {
    if (!dates.includes(o.date)) return "Overtime must be on a day in this cutoff.";
    if (!isTime(o.start) || !isTime(o.end)) return "Check the overtime times.";
    if (o.start === o.end) return "Overtime needs an end time after its start.";
  }
  return null;
}

/** Saves every day of one cutoff and its overtime. */
export async function saveCutoff(input: CutoffInput): Promise<PayrollResult> {
  const problem = validateCutoff(input);
  if (problem) return { error: problem };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const period = periodContaining(input.start);
  const days = input.days.map((d) => {
    const leave = d.status === "leave";
    const note = leave ? d.note?.replace(/\s+/g, " ").trim() || null : null;
    return {
      work_date: d.date,
      status: d.status,
      leave_type: leave ? d.leaveType : null,
      note,
      time_in: d.status === "worked" ? d.timeIn : null,
    };
  });

  const savedDays = await supabase.from("payroll_days").upsert(days, { onConflict: "user_id,work_date" });
  if (savedDays.error?.code === "PGRST205") return MISSING;
  if (savedDays.error) return FAILED;

  const cleared = await supabase
    .from("payroll_overtime")
    .delete()
    .gte("work_date", period.start)
    .lte("work_date", period.end);
  if (cleared.error) return FAILED;
  if (input.overtime.length) {
    const { error } = await supabase.from("payroll_overtime").insert(
      input.overtime.map((o) => ({ work_date: o.date, starts_at: o.start, ends_at: o.end })),
    );
    if (error) return FAILED;
  }

  return sync(supabase);
}

/**
 * Which pay a contribution comes out of: the day it's due each month, one of
 * your paydays (the 15th or the 30th). Your forecast, Safe to spend and Bills
 * by payday follow it.
 */
export async function setContributionDay(key: ContributionKey, day: number): Promise<PayrollResult> {
  if (!["sss", "philhealth", "pagibig"].includes(key)) return { error: "Pick a contribution." };
  if (!(Number.isInteger(day) && day >= 1 && day <= 31)) return { error: "Pick a day." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data, error } = await supabase
    .from("recurring_items")
    .update({ day1: day })
    .eq("payroll_key", key)
    .eq("frequency", "monthly")
    .select("id");
  if (error) return FAILED;
  if (!data.length) return { error: "Save your pay first, so the bill is in Money going out." };

  refresh();
  return {};
}

/**
 * Brings Money coming in and going out in line with the calculator: the
 * payday's typical amount, the monthly contributions and the next four
 * income tax payments. Paid ones are never touched.
 */
async function sync(supabase: Client): Promise<PayrollResult> {
  const today = getToday();
  const payroll = await readPayroll(supabase, today).catch(() => null);
  if (payroll === "missing") return MISSING;
  if (!payroll) return FAILED;
  const { settings } = payroll;

  // The payday's own amount: what Money and Settings show as a typical payday.
  // The forecast works out each payday from its cutoff.
  const payday = await supabase
    .from("recurring_items")
    .update({ amount: typicalCutoffPay(settings), amount_varies: true })
    .eq("kind", "payday")
    .eq("frequency", "twice_monthly");
  if (payday.error) return FAILED;

  // SSS, PhilHealth and Pag-IBIG: monthly, on the 30th unless you picked the 15th (setContributionDay).
  const bills = await supabase.from("recurring_items").select("id, payroll_key, day1").not("payroll_key", "is", null);
  if (bills.error) return FAILED;
  const wanted = contributions(settings);
  for (const c of wanted) {
    const found = bills.data.find((b) => b.payroll_key === c.key);
    const row = {
      kind: "bill",
      name: c.name,
      amount: c.amount,
      amount_varies: false,
      category: "gov",
      frequency: "monthly",
      day1: found?.day1 ?? RATES.contributionDay,
      day2: null,
      payroll_key: c.key,
    };
    const { error } = found
      ? await supabase.from("recurring_items").update(row).eq("id", found.id)
      : await supabase.from("recurring_items").insert(row);
    if (error) return FAILED;
  }
  const dropped = bills.data.filter((b) => !wanted.some((c) => c.key === b.payroll_key)).map((b) => b.id);
  if (dropped.length) {
    const { error } = await supabase.from("recurring_items").delete().in("id", dropped);
    if (error) return FAILED;
  }

  // Income tax: the next four payments, each on its own date.
  const taxes = await supabase
    .from("planned_expenses")
    .select("id, payroll_key, due_on, transaction_id")
    .not("payroll_key", "is", null);
  if (taxes.error) return FAILED;
  const due = settings.payTax ? upcomingTaxPayments(payroll, today).filter((t) => t.amount > 0) : [];
  for (const t of due) {
    const found = taxes.data.find((row) => row.payroll_key === t.key);
    if (found?.transaction_id) continue;
    const row = {
      type: "expense",
      name: t.name,
      amount: t.amount,
      category: "gov",
      due_on: t.dueOn,
      payroll_key: t.key,
    };
    const { error } = found
      ? await supabase.from("planned_expenses").update(row).eq("id", found.id)
      : await supabase.from("planned_expenses").insert(row);
    if (error) return FAILED;
  }
  // Upcoming unpaid ones that are no longer owed (pay went down, or tax
  // turned off). Late ones stay: they're still owed.
  const stale = taxes.data
    .filter((row) => !row.transaction_id && row.due_on >= today && !due.some((t) => t.key === row.payroll_key))
    .map((row) => row.id);
  if (stale.length) {
    const { error } = await supabase.from("planned_expenses").delete().in("id", stale);
    if (error) return FAILED;
  }

  refresh();
  return {};
}

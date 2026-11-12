"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { readPayroll } from "@/lib/data";
import { addDays, isValidDate, today as getToday } from "@/lib/dates";
import { MAX_AMOUNT, roundCents } from "@/lib/money";
import { isValidSchedule, type Frequency, type Schedule } from "@/lib/schedule";
import {
  DEFAULT_CUTOFF_WEEKDAY,
  KINSENA,
  RATES,
  contributions,
  cutoffChangeProblem,
  cutoffContaining,
  cutoffDates,
  cutoffDaysOf,
  cutoffRuleOf,
  dailyFromMonthly,
  isCutoffDays,
  isCutoffMonthDay,
  isCutoffWeekday,
  isTime,
  isWeekendMode,
  pageRule,
  rateOf,
  sameRate,
  settingsFor,
  typicalCutoffPay,
  upcomingTaxPayments,
  type ContributionKey,
  type CutoffChange,
  type CutoffRate,
  type CutoffRule,
  type OvertimeEntry,
  type PayrollDay,
  type PayrollSettings,
} from "@/lib/payroll";

// Payroll calculator. Saving your pay or a cutoff also updates the payday
// (how you're paid, and its amount) and the SSS, PhilHealth, Pag-IBIG and
// income tax bills in Money going out. See 0013_payroll.sql and 0023.

export type PayrollResult = { error?: string };

type Client = NonNullable<Awaited<ReturnType<typeof signedInClient>>>;

const FAILED = { error: "Couldn't save that. Please try again." };
const MISSING = { error: "Run step 13 in supabase/SQL_GUIDE.md first, then try again." };
const STEP_23 = (what: string) => ({ error: `To ${what}, run step 23 in supabase/SQL_GUIDE.md first.` });

function validateSettings(s: PayrollSettings): string | null {
  if (s.monthlyPay != null && !(s.monthlyPay > 0 && s.monthlyPay <= MAX_AMOUNT)) return "Enter your monthly pay.";
  if (!(s.dailyRate > 0 && s.dailyRate <= MAX_AMOUNT)) return "Enter your daily rate.";
  if (!(s.hoursPerDay > 0 && s.hoursPerDay <= 24)) return "Hours per day should be between 1 and 24.";
  if (!isTime(s.startTime)) return "Check your start time.";
  if (!(s.overtimeRate >= 1 && s.overtimeRate <= 5)) return "Overtime rate should be between 1 and 5.";
  if (s.monthlyBase !== null && !(s.monthlyBase > 0 && s.monthlyBase <= MAX_AMOUNT)) {
    return "Check the monthly pay for contributions, or leave it blank.";
  }
  if (s.startedOn !== null && !isValidDate(s.startedOn)) return "Check the date you started, or leave it blank.";
  if (s.cutoffDays !== undefined && !isCutoffDays(s.cutoffDays)) return "Pick two different days, 1 to 28, for your cutoffs.";
  if (s.cutoffWeekday !== undefined && !isCutoffWeekday(s.cutoffWeekday)) return "Pick the day your cutoff week starts.";
  if (s.cutoffMonthDay !== undefined && !isCutoffMonthDay(s.cutoffMonthDay)) return "Pick a day, 1 to 28, for your cutoff to start.";
  if (s.saturday !== undefined && !isWeekendMode(s.saturday)) return "Pick what a Saturday is.";
  if (s.sunday !== undefined && !isWeekendMode(s.sunday)) return "Pick what a Sunday is.";
  return null;
}

type SavedParts = Pick<PayrollSettings, "cutoffDays" | "cutoffWeekday" | "cutoffMonthDay" | "monthlyPay" | "saturday" | "sunday">;

/**
 * Your cutoff days and weekends as saved, each null (or 'off') when it's the
 * usual: the 1st and 16th (twice a month), Monday (weekly), the 1st
 * (monthly), weekends off, pay per day.
 */
function partColumns(s: SavedParts) {
  const days = cutoffDaysOf(s);
  const kinsena = days[0] === KINSENA[0] && days[1] === KINSENA[1];
  const weekday = s.cutoffWeekday ?? DEFAULT_CUTOFF_WEEKDAY;
  const monthDay = s.cutoffMonthDay ?? 1;
  return {
    v21: { cutoff_day1: kinsena ? null : days[0], cutoff_day2: kinsena ? null : days[1] },
    v22: {
      cutoff_weekday: weekday === DEFAULT_CUTOFF_WEEKDAY ? null : weekday,
      cutoff_month_day: monthDay === 1 ? null : monthDay,
    },
    v23: {
      monthly_pay: s.monthlyPay ? roundCents(s.monthlyPay) : null,
      saturday: s.saturday ?? "off",
      sunday: s.sunday ?? "off",
    },
  };
}

/** PostgREST says PGRST204 for a column it doesn't know, Postgres 42703. */
const missingColumn = (error: { code?: string } | null) => error?.code === "PGRST204" || error?.code === "42703";

/**
 * Writes `row` with your cutoff days, weekends and monthly pay. Before
 * migrations 0021 to 0023 their columns aren't there: fine for the usual
 * (written without them), an error for anything else.
 */
async function writeWithCutoffDays(
  parts: SavedParts,
  row: Record<string, unknown>,
  write: (row: Record<string, unknown>) => PromiseLike<{ error: { code?: string } | null }>,
): Promise<PayrollResult | null> {
  const { v21, v22, v23 } = partColumns(parts);
  const first = await write({ ...row, ...v21, ...v22, ...v23 });
  if (!missingColumn(first.error)) return first.error ? FAILED : null;
  if (v23.monthly_pay !== null) return STEP_23("use a monthly rate");
  if (v23.saturday !== "off" || v23.sunday !== "off") return STEP_23("work weekends");
  const second = await write({ ...row, ...v21, ...v22 });
  if (!missingColumn(second.error)) return second.error ? FAILED : null;
  if (v22.cutoff_weekday !== null || v22.cutoff_month_day !== null) {
    return { error: "To pick when your cutoff starts, run step 22 in supabase/SQL_GUIDE.md first." };
  }
  const third = await write({ ...row, ...v21 });
  if (!missingColumn(third.error)) return third.error ? FAILED : null;
  if (v21.cutoff_day1 !== null) return { error: "To use your own cutoff days, run step 21 in supabase/SQL_GUIDE.md first." };
  const fourth = await write(row);
  return fourth.error ? FAILED : null;
}

/** How often you're paid: your payday's schedule. Twice a month without one. */
async function payFrequency(supabase: Client): Promise<Frequency> {
  const { data } = await supabase.from("recurring_items").select("frequency").eq("kind", "payday").maybeSingle();
  return (data?.frequency as Frequency | undefined) ?? "twice_monthly";
}

/** Cutoffs on other dates than usual. None before migration 0023. */
async function savedCutoffChanges(supabase: Client): Promise<CutoffChange[]> {
  const { data } = await supabase.from("payroll_cutoff_changes").select("usual_start, starts_on, ends_on, paid_on");
  return (data ?? []).map((c) => ({ usual: c.usual_start, start: c.starts_on, end: c.ends_on, paidOn: c.paid_on }));
}

/** Your cutoffs, from your settings, how often you're paid, and any on other dates. */
async function savedCutoffRule(supabase: Client): Promise<CutoffRule> {
  const [{ data }, frequency, cutoffChanges] = await Promise.all([
    supabase.from("payroll_settings").select("*").maybeSingle(),
    payFrequency(supabase),
    savedCutoffChanges(supabase),
  ]);
  return cutoffRuleOf({
    frequency,
    cutoffChanges,
    ...(data?.cutoff_day1 != null && data?.cutoff_day2 != null
      ? { cutoffDays: [Number(data.cutoff_day1), Number(data.cutoff_day2)] as const }
      : {}),
    ...(data?.cutoff_weekday != null ? { cutoffWeekday: Number(data.cutoff_weekday) } : {}),
    ...(data?.cutoff_month_day != null ? { cutoffMonthDay: Number(data.cutoff_month_day) } : {}),
  });
}

/**
 * Saves how you're paid on your payday, adding one if you had none. Amounts
 * typed per payday go: the calculator works each one out.
 */
async function savePaydaySchedule(supabase: Client, schedule: Schedule): Promise<PayrollResult | null> {
  const weeks = schedule.frequency === "weekly" && schedule.weeks?.length ? [...schedule.weeks] : null;
  const weekdays = schedule.frequency === "daily" && schedule.weekdays?.length ? [...schedule.weekdays] : null;
  const base = { frequency: schedule.frequency, day1: schedule.day1, day2: schedule.day2 };
  const found = await supabase.from("recurring_items").select("id").eq("kind", "payday").maybeSingle();
  if (found.error) return FAILED;
  const write = (row: Record<string, unknown>) =>
    found.data
      ? supabase.from("recurring_items").update(row).eq("id", found.data.id)
      : supabase.from("recurring_items").insert({ kind: "payday", name: "Payday", amount_varies: true, ...row });

  let result = await write({ ...base, pay_weeks: weeks, pay_amounts: null, pay_weekdays: weekdays });
  if (missingColumn(result.error)) {
    if (schedule.frequency === "daily") return STEP_23("get paid every work day");
    result = await write({ ...base, pay_weeks: weeks, pay_amounts: null });
    if (missingColumn(result.error)) {
      if (weeks) return { error: "To pick which weeks pay, run step 22 in supabase/SQL_GUIDE.md first." };
      result = await write(base);
    }
  }
  // 23514: a check failed, so 'daily' isn't allowed yet.
  if (result.error?.code === "23514" && schedule.frequency === "daily") return STEP_23("get paid every work day");
  return result.error ? FAILED : null;
}

const CHANGES_MISSING = { error: "To change your pay from one cutoff on, run step 21 in supabase/SQL_GUIDE.md first." };

/** The rate columns, rounded like the database keeps them. monthly_pay only when set (migration 0023). */
function rateRow(r: CutoffRate) {
  return {
    daily_rate: roundCents(r.dailyRate),
    hours_per_day: Math.round(r.hoursPerDay * 100) / 100,
    start_time: r.startTime,
    overtime_rate: Math.round(r.overtimeRate * 100) / 100,
    ...(r.monthlyPay ? { monthly_pay: roundCents(r.monthlyPay) } : {}),
  };
}

/**
 * Saves your pay, and how you're paid when `schedule` is given. `from`
 * null: this rate is your pay for every cutoff, and any pay changes go.
 * `from` a cutoff's first day: the rate is your pay from that cutoff on
 * (until a later change); the cutoffs before it keep theirs. The rest
 * (weekends, contributions, the day you started) is the same for every cutoff.
 */
export async function savePayrollSettings(
  input: PayrollSettings,
  from: string | null = null,
  schedule: Schedule | null = null,
): Promise<PayrollResult> {
  // A monthly rate's day is ÷ 22, whatever the form sent.
  if (input.monthlyPay) input = { ...input, dailyRate: dailyFromMonthly(input.monthlyPay) };
  const problem = validateSettings(input);
  if (problem) return { error: problem };
  if (schedule && !isValidSchedule(schedule)) return { error: "Check your paydays." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  // Cutoffs follow your payday: the one you just picked, or the saved one.
  const parts: SavedParts = {
    cutoffDays: input.cutoffDays,
    cutoffWeekday: input.cutoffWeekday,
    cutoffMonthDay: input.cutoffMonthDay,
    monthlyPay: input.monthlyPay ?? null,
    saturday: input.saturday,
    sunday: input.sunday,
  };
  const frequency = schedule?.frequency ?? (await payFrequency(supabase));
  const rule = cutoffRuleOf({ ...parts, frequency, cutoffChanges: await savedCutoffChanges(supabase) });
  if (from !== null && (!isValidDate(from) || cutoffContaining(from, rule).start !== from)) return { error: "Pick a cutoff." };

  const shared = {
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

  if (schedule) {
    const failed = await savePaydaySchedule(supabase, schedule);
    if (failed) return failed;
  }

  // First time, or for every cutoff: the rate goes on your settings.
  if (!existing.data || from === null) {
    const userId = existing.data?.user_id;
    const failed = await writeWithCutoffDays(parts, { ...rateRow(input), ...shared }, (row) =>
      userId ? supabase.from("payroll_settings").update(row).eq("user_id", userId) : supabase.from("payroll_settings").insert(row),
    );
    if (failed) return failed;
    if (existing.data) {
      const cleared = await supabase.from("payroll_pay_changes").delete().not("starts_on", "is", null);
      if (cleared.error && cleared.error.code !== "PGRST205") return FAILED;
    }
    return sync(supabase);
  }

  const before = await readPayroll(supabase, getToday()).catch(() => null);
  if (!before || before === "missing") return FAILED;
  const userId = existing.data.user_id;
  const failed = await writeWithCutoffDays(parts, shared, (row) =>
    supabase.from("payroll_settings").update(row).eq("user_id", userId),
  );
  if (failed) return failed;
  // Days just changed: pay before `from` is read with the new cutoffs.
  before.settings = { ...before.settings, ...parts, frequency };

  // The same as the cutoff before it already gets: no change to keep.
  const unchanged = sameRate(rateOf(input), settingsFor(before, addDays(from, -1)));
  const { error } = unchanged
    ? await supabase.from("payroll_pay_changes").delete().eq("starts_on", from)
    : await supabase.from("payroll_pay_changes").upsert({ starts_on: from, ...rateRow(input) }, { onConflict: "user_id,starts_on" });
  if (error?.code === "PGRST205") return CHANGES_MISSING;
  if (missingColumn(error)) return STEP_23("use a monthly rate");
  if (error) return FAILED;

  return sync(supabase);
}

const CUTOFF_CHANGES_MISSING = STEP_23("change a cutoff's dates");

/**
 * Puts one cutoff on other dates (and its payday on another day, if
 * `paidOn`). The cutoffs either side move to meet it.
 */
export async function saveCutoffChange(change: CutoffChange): Promise<PayrollResult> {
  if (![change.usual, change.start, change.end].every(isValidDate)) return { error: "Pick the dates." };
  if (change.paidOn !== null && !isValidDate(change.paidOn)) return { error: "Check the day it's paid." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const rule = await savedCutoffRule(supabase);
  const problem = cutoffChangeProblem(change, rule, getToday());
  if (problem) return { error: problem };
  const { error } = await supabase.from("payroll_cutoff_changes").upsert(
    { usual_start: change.usual, starts_on: change.start, ends_on: change.end, paid_on: change.paidOn },
    { onConflict: "user_id,usual_start" },
  );
  if (error?.code === "PGRST205") return CUTOFF_CHANGES_MISSING;
  if (error) return FAILED;
  return sync(supabase);
}

/** Puts a cutoff back on its usual dates and payday. */
export async function removeCutoffChange(usual: string): Promise<PayrollResult> {
  if (!isValidDate(usual)) return { error: "Pick a cutoff." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { error } = await supabase.from("payroll_cutoff_changes").delete().eq("usual_start", usual);
  if (error?.code === "PGRST205") return CUTOFF_CHANGES_MISSING;
  if (error) return FAILED;
  return sync(supabase);
}

/** Drops a pay change: its cutoffs go back to the pay before it. */
export async function removePayChange(from: string): Promise<PayrollResult> {
  if (!isValidDate(from)) return { error: "Pick a pay change." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { error } = await supabase.from("payroll_pay_changes").delete().eq("starts_on", from);
  if (error?.code === "PGRST205") return CHANGES_MISSING;
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
  if (missingColumn(error)) {
    return { error: "To use your own amounts, run step 18 in supabase/SQL_GUIDE.md first." };
  }
  if (error) return FAILED;
  if (!data.length) return { error: "Set up your pay first." };

  return sync(supabase);
}

export type CutoffInput = {
  /** The cutoff's first day. */
  start: string;
  days: PayrollDay[];
  overtime: OvertimeEntry[];
};

function validateCutoff(input: CutoffInput, cutoffDays: CutoffRule): string | null {
  if (!isValidDate(input.start)) return "Pick a cutoff.";
  const period = cutoffContaining(input.start, cutoffDays);
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
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  // Daily pay saves a week at a time.
  const cutoffDays = pageRule(await savedCutoffRule(supabase));
  const problem = validateCutoff(input, cutoffDays);
  if (problem) return { error: problem };
  const period = cutoffContaining(input.start, cutoffDays);
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
  // Contributions and the typical payday follow the pay of the cutoff you're in now.
  const settings = settingsFor(payroll, today);

  // The payday's own amount: what Money and Settings show as a typical payday.
  // The forecast works out each payday from its cutoffs, so amounts typed
  // per week or per payday give way to the calculator's.
  const typical = { amount: typicalCutoffPay(settings), amount_varies: true };
  let payday = await supabase.from("recurring_items").update({ ...typical, pay_amounts: null }).eq("kind", "payday");
  // Before migration 0022 there are no amounts per payday to clear.
  if (missingColumn(payday.error)) payday = await supabase.from("recurring_items").update(typical).eq("kind", "payday");
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

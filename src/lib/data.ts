import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { HISTORY_MONTHS, bnplCap, estimateMonth, type BnplCap, type MoneyHistory } from "@/lib/bnpl";
import { subcategoryOptions } from "@/lib/categories";
import { addDays, dateInMonth, daysBetween, monthContaining } from "@/lib/dates";
import { scheduledItems, sortItems, type ForecastItem, type ScheduleInputs } from "@/lib/forecast";
import { getUsdRate, type UsdRate } from "@/lib/fx";
import type { PriceMemory } from "@/lib/grocery";
import {
  countsAsSpending,
  isCurrency,
  isInterestPayout,
  isSpendable,
  isWalletPurpose,
  pesoTotal,
  roundCents,
  type AccountType,
  type Currency,
  type InterestPayout,
  type TransactionType,
  type WalletPurpose,
} from "@/lib/money";
import { paydayAmounts, type PayrollRecords } from "@/lib/payroll";
import { personItems, type EntryKind, type Person } from "@/lib/people";
import type { Frequency } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";

// Reads for the signed-in user. Row-level security limits every query to the
// user's own rows. These read cookies, so callers must sit behind <Suspense>.

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  startingBalance: number;
  /** Below 0 on a credit line or loan: what you owe. */
  balance: number;
  /** Credit lines only. */
  creditLimit: number | null;
  /** Credit lines: the day of the month the bill is due. */
  dueDay: number | null;
  archived: boolean;
  /** Cash, bank and e-wallets: what the money is for. Only "spending" counts in Safe to spend. */
  purpose: WalletPurpose;
  /** Banks and e-wallets that pay daily interest: % a year. */
  interestRate: number | null;
  /** When the current rate was set: interest estimates start here. */
  interestSince: string | null;
  /** When the bank credits it: daily (MariBank) or on the 1st (GoTyme Go Save). */
  interestPayout: InterestPayout;
  /** A savings target, like a GoTyme GoalSave (migration 0016). */
  goalAmount: number | null;
  /** The goal's deadline, if it has one. */
  goalDate: string | null;
  /** Balance and transactions are in this currency (migration 0017). */
  currency: Currency;
  /**
   * USD wallets: pesos per US$1 it's worth now, to count it in pesos. Today's
   * rate when a feed answers, else `boughtAt`. Null for pesos.
   */
  fxRate: number | null;
  /** USD wallets: the rate you got for these dollars, on average. What the gain is measured from. */
  boughtAt: number | null;
  /** USD wallets valued at today's rate: the day the feed last updated. Null when using `boughtAt`. */
  fxAsOf: string | null;
  /** Time deposits: the day it matures. */
  maturesOn: string | null;
};

export type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  /** A transfer between pesos and dollars: what landed, in the destination's currency (migration 0017). */
  toAmount: number | null;
  category: string | null;
  /** Typed in Add, like "Jeep" under Transpo (migration 0015). */
  subcategory: string | null;
  note: string | null;
  occurredOn: string;
  /** When it was logged (an ISO timestamp); shown as the time of day. */
  createdAt: string | null;
  /** "15:42", the time of day it happened, when picked in Add / Edit (migration 0014). */
  occurredTime: string | null;
  /** The same on every record of one split bill (migration 0012). */
  splitId: string | null;
};

export type RecurringItem = {
  id: string;
  /** "bill" is any recurring expense; "income" any recurring income besides payday. */
  kind: "payday" | "bill" | "income";
  name: string;
  amount: number | null;
  amountVaries: boolean;
  accountId: string | null;
  category: string | null;
  frequency: Frequency;
  day1: number;
  day2: number | null;
  endsOn: string | null;
  /** Set on SSS, PhilHealth and Pag-IBIG bills the payroll calculator manages. */
  payrollKey: string | null;
};

export type BillPayment = {
  recurringItemId: string;
  dueOn: string;
  transactionId: string;
};

/** A one-off planned cashflow: money out (expense) or in (income). */
export type PlannedExpense = {
  id: string;
  type: "expense" | "income";
  name: string;
  amount: number;
  category: string;
  dueOn: string;
  accountId: string | null;
  transactionId: string | null;
  /** Set on income tax payments the payroll calculator manages ("2026-Q3"). */
  payrollKey: string | null;
};

export type Budget = { id: string; category: string; amount: number };

/** A BNPL purchase or a loan, paid down in installments (Phase 3). */
export type InstallmentPlan = {
  id: string;
  kind: "bnpl" | "loan";
  accountId: string;
  name: string;
  principal: number;
  feeTotal: number;
  months: number;
  payFromAccountId: string | null;
  /** The purchase behind it (a split bill: one of its records); null for a bill added by hand. */
  sourceTxnId: string | null;
  payments: ScheduledPayment[];
};

export type ScheduledPayment = {
  id: string;
  planId: string;
  seq: number;
  dueOn: string;
  amount: number;
  principalPart: number;
  feePart: number;
  /** The transfer or fee transaction once paid; null while unpaid. */
  transactionId: string | null;
};

/** A recent expense, income or transfer to repeat with one tap in Add. */
export type Template = Omit<Transaction, "id" | "occurredOn" | "createdAt" | "occurredTime" | "splitId">;

/**
 * Supabase errors are plain objects; wrap them so error pages and logs show
 * the code and message. PGRST205 means a table is missing: a migration in
 * supabase/migrations hasn't been run yet.
 */
function dbError(error: { code?: string; message: string }) {
  return new Error(`Supabase ${error.code ?? "error"}: ${error.message}`, { cause: error });
}

// One client per request, shared by every read in it.
const db = cache(async () => {
  // Supabase checks token expiry with Date.now(); see lib/auth.ts.
  await connection();
  return createClient();
});

/**
 * Wallets, credit lines and loans. People (utang and pautang) are accounts
 * too, but only come back with `includePeople`: see getPeople.
 */
export async function getAccounts({ includeArchived = false, includePeople = false } = {}): Promise<Account[]> {
  // Home, Plan and the Add sheet over them each ask for accounts; read once
  // per request. cache() compares arguments by identity, so pass plain flags.
  return readAccounts(includeArchived, includePeople);
}

const readAccounts = cache(async (includeArchived: boolean, includePeople: boolean): Promise<Account[]> => {
  const supabase = await db();
  const select = (columns: string) => {
    let query = supabase.from("accounts").select(columns).order("created_at");
    if (!includeArchived) query = query.eq("archived", false);
    if (!includePeople) query = query.neq("type", "person");
    return query;
  };
  const base = "id, name, type, starting_balance, credit_limit, due_day, archived";

  const wallet = `${base}, purpose, interest_rate, interest_since`;
  const payout = `${wallet}, interest_payout`;
  const goals = `${payout}, goal_amount, goal_date`;

  const [first, balances] = await Promise.all([
    select(`${goals}, currency, fx_rate, matures_on`),
    supabase.from("account_balances").select("account_id, balance"),
  ]);
  // 42703: migration 0017 (or 0016, 0011, 0010) hasn't been run yet. Every
  // wallet is then in pesos, wallets have no goals, interest is credited
  // daily, and without 0010 every wallet is spending money.
  let accounts = first;
  for (const columns of [goals, payout, wallet, base]) {
    if (accounts.error?.code !== "42703") break;
    accounts = await select(columns);
  }
  if (accounts.error) throw dbError(accounts.error);
  if (balances.error) throw dbError(balances.error);

  const balanceById = new Map(
    balances.data.map((b) => [b.account_id as string, Number(b.balance)]),
  );
  const rows = accounts.data as unknown as AccountRow[];
  // Dollar wallets count at today's rate; only looked up when you have one.
  const today = rows.some((a) => a.currency === "USD") ? await getUsdRate() : null;
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as AccountType,
    startingBalance: Number(a.starting_balance),
    balance: balanceById.get(a.id) ?? Number(a.starting_balance),
    creditLimit: a.credit_limit === null ? null : Number(a.credit_limit),
    dueDay: a.due_day,
    archived: a.archived,
    purpose: isWalletPurpose(a.purpose) ? a.purpose : "spending",
    interestRate: a.interest_rate == null ? null : Number(a.interest_rate),
    interestSince: a.interest_since ?? null,
    interestPayout: isInterestPayout(a.interest_payout) ? a.interest_payout : "daily",
    goalAmount: a.goal_amount == null ? null : Number(a.goal_amount),
    goalDate: a.goal_date ?? null,
    currency: isCurrency(a.currency) ? a.currency : "PHP",
    ...dollarRates(a, today),
    maturesOn: a.matures_on ?? null,
  }));
});

/** A USD wallet's rates: worth now (today's, else yours) and what you got. */
function dollarRates(a: AccountRow, today: UsdRate | null) {
  const boughtAt = a.currency === "USD" && a.fx_rate != null ? Number(a.fx_rate) : null;
  if (boughtAt === null) return { fxRate: null, boughtAt: null, fxAsOf: null };
  return today
    ? { fxRate: today.rate, boughtAt, fxAsOf: today.asOf }
    : { fxRate: boughtAt, boughtAt, fxAsOf: null };
}

type AccountRow = {
  id: string;
  name: string;
  type: string;
  starting_balance: number | string;
  credit_limit: number | string | null;
  due_day: number | null;
  archived: boolean;
  purpose?: string;
  interest_rate?: number | string | null;
  interest_since?: string | null;
  interest_payout?: string;
  goal_amount?: number | string | null;
  goal_date?: string | null;
  currency?: string;
  fx_rate?: number | string | null;
  matures_on?: string | null;
};

/** The last day interest was logged on each wallet, by account id. */
export async function getLastInterest(): Promise<Map<string, string>> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("transactions")
    .select("account_id, occurred_on")
    .eq("type", "income")
    .eq("category", "interest")
    .order("occurred_on", { ascending: false })
    .limit(500);
  if (error) throw dbError(error);
  const last = new Map<string, string>();
  for (const row of data) if (!last.has(row.account_id)) last.set(row.account_id, row.occurred_on);
  return last;
}

const RECURRING_COLUMNS = "id, kind, name, amount, amount_varies, account_id, category, frequency, day1, day2, ends_on";

type RecurringRow = {
  id: string;
  kind: RecurringItem["kind"];
  name: string;
  amount: number | string | null;
  amount_varies: boolean;
  account_id: string | null;
  category: string | null;
  frequency: Frequency;
  day1: number;
  day2: number | null;
  ends_on: string | null;
  payroll_key?: string | null;
};

export async function getRecurringItems(): Promise<RecurringItem[]> {
  const supabase = await db();
  const select = (columns: string) => supabase.from("recurring_items").select(columns).order("created_at");
  // 42703: migration 0013 (payroll_key) hasn't been run yet.
  const first = await select(`${RECURRING_COLUMNS}, payroll_key`);
  const { data, error } = first.error?.code === "42703" ? await select(RECURRING_COLUMNS) : first;
  if (error) throw dbError(error);
  return (data as unknown as RecurringRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    amount: r.amount === null ? null : Number(r.amount),
    amountVaries: r.amount_varies,
    accountId: r.account_id,
    category: r.category,
    frequency: r.frequency,
    day1: r.day1,
    day2: r.day2,
    endsOn: r.ends_on,
    payrollKey: r.payroll_key ?? null,
  }));
}

/** Bill payments for scheduled dates on or after `from`. */
export async function getBillPayments(from: string): Promise<BillPayment[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("bill_payments")
    .select("recurring_item_id, due_on, transaction_id")
    .gte("due_on", from);
  if (error) throw dbError(error);
  return data.map((p) => ({
    recurringItemId: p.recurring_item_id,
    dueOn: p.due_on,
    transactionId: p.transaction_id,
  }));
}

/**
 * Which of these transactions paid a bill, a planned item or an installment.
 * Those were already counted in Safe to spend as "due before payday", so
 * they aren't counted again as spending.
 */
export async function getScheduledTransactionIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const supabase = await db();
  const list = ids.join(",");
  const [bills, planned, payments] = await Promise.all([
    supabase.from("bill_payments").select("transaction_id").in("transaction_id", ids),
    supabase.from("planned_expenses").select("transaction_id").in("transaction_id", ids),
    supabase
      .from("scheduled_payments")
      .select("transfer_txn_id, fee_txn_id")
      .or(`transfer_txn_id.in.(${list}),fee_txn_id.in.(${list})`),
  ]);
  if (bills.error) throw dbError(bills.error);
  if (planned.error) throw dbError(planned.error);
  if (payments.error) throw dbError(payments.error);
  return new Set(
    [
      ...bills.data.map((r) => r.transaction_id),
      ...planned.data.map((r) => r.transaction_id),
      ...payments.data.flatMap((r) => [r.transfer_txn_id, r.fee_txn_id]),
    ].filter((id): id is string => Boolean(id)),
  );
}

/** Planned items due on or after `from`, plus any still unlogged from before. */
export async function getPlannedExpenses(from: string): Promise<PlannedExpense[]> {
  const supabase = await db();
  const base = "id, type, name, amount, category, due_on, account_id, transaction_id";
  const select = (columns: string) =>
    supabase
      .from("planned_expenses")
      .select(columns)
      .or(`due_on.gte.${from},transaction_id.is.null`)
      .order("due_on");
  // 42703: migration 0013 (payroll_key) hasn't been run yet.
  const first = await select(`${base}, payroll_key`);
  const { data, error } = first.error?.code === "42703" ? await select(base) : first;
  if (error) throw dbError(error);
  return (data as unknown as PlannedRow[]).map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    amount: Number(p.amount),
    category: p.category,
    dueOn: p.due_on,
    accountId: p.account_id,
    transactionId: p.transaction_id,
    payrollKey: p.payroll_key ?? null,
  }));
}

type PlannedRow = {
  id: string;
  type: PlannedExpense["type"];
  name: string;
  amount: number | string;
  category: string;
  due_on: string;
  account_id: string | null;
  transaction_id: string | null;
  payroll_key?: string | null;
};

/**
 * The payroll calculator's settings, saved days and overtime from Jan 1 last
 * year (enough for this year's tax). Null when it isn't set up; "missing"
 * while migration 0013 hasn't been run.
 */
export async function getPayroll(today: string): Promise<PayrollRecords | null | "missing"> {
  const supabase = await db();
  return readPayroll(supabase, today);
}

/** getPayroll with a client you already have, e.g. in a Server Action. */
export async function readPayroll(
  supabase: Awaited<ReturnType<typeof createClient>>,
  today: string,
): Promise<PayrollRecords | null | "missing"> {
  const from = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const [s, d, o] = await Promise.all([
    supabase.from("payroll_settings").select("*").maybeSingle(),
    supabase
      .from("payroll_days")
      .select("work_date, status, leave_type, note, time_in")
      .gte("work_date", from)
      .order("work_date"),
    supabase
      .from("payroll_overtime")
      .select("work_date, starts_at, ends_at")
      .gte("work_date", from)
      .order("work_date")
      .order("starts_at"),
  ]);
  if (s.error?.code === "PGRST205") return "missing";
  if (s.error) throw dbError(s.error);
  if (d.error) throw dbError(d.error);
  if (o.error) throw dbError(o.error);
  if (!s.data) return null;
  const row = s.data;
  return {
    settings: {
      dailyRate: Number(row.daily_rate),
      hoursPerDay: Number(row.hours_per_day),
      startTime: String(row.start_time).slice(0, 5),
      overtimeRate: Number(row.overtime_rate),
      monthlyBase: row.monthly_base === null ? null : Number(row.monthly_base),
      startedOn: row.started_on,
      paySss: row.pay_sss,
      payPhilhealth: row.pay_philhealth,
      payPagibig: row.pay_pagibig,
      payTax: row.pay_tax,
      // Undefined until migration 0018 is run.
      sssAmount: row.sss_amount == null ? null : Number(row.sss_amount),
      philhealthAmount: row.philhealth_amount == null ? null : Number(row.philhealth_amount),
      pagibigAmount: row.pagibig_amount == null ? null : Number(row.pagibig_amount),
    },
    days: d.data.map((day) => ({
      date: day.work_date,
      status: day.status,
      leaveType: day.leave_type,
      note: day.note,
      timeIn: day.time_in ? String(day.time_in).slice(0, 5) : null,
    })),
    overtime: o.data.map((ot) => ({
      date: ot.work_date,
      start: String(ot.starts_at).slice(0, 5),
      end: String(ot.ends_at).slice(0, 5),
    })),
  };
}

/**
 * Each payday's own amount when the payroll calculator is set up. It needs
 * pay twice a month: one cutoff per payday.
 */
async function payrollAmounts(recurring: RecurringItem[], today: string, until: string) {
  const payday = recurring.find((r) => r.kind === "payday");
  if (payday?.frequency !== "twice_monthly") return undefined;
  const payroll = await getPayroll(today);
  if (!payroll || payroll === "missing") return undefined;
  return paydayAmounts(payroll, payday, today, until, today);
}

export async function getBudgets(): Promise<Budget[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("budgets")
    .select("id, category, amount")
    .order("created_at");
  if (error) throw dbError(error);
  return data.map((b) => ({ id: b.id, category: b.category, amount: Number(b.amount) }));
}

/**
 * Installment plans with their payments, oldest first. `accountId` limits
 * it to one credit line or loan.
 */
export async function getInstallmentPlans(accountId?: string): Promise<InstallmentPlan[]> {
  const supabase = await db();
  let plans = supabase
    .from("installment_plans")
    .select("id, kind, account_id, name, principal, fee_total, months, pay_from_account_id, source_txn_id")
    .order("created_at");
  if (accountId) plans = plans.eq("account_id", accountId);
  const [p, s] = await Promise.all([
    plans,
    supabase
      .from("scheduled_payments")
      .select("id, plan_id, seq, due_on, amount, principal_part, fee_part, transfer_txn_id, fee_txn_id")
      .order("due_on"),
  ]);
  if (p.error) throw dbError(p.error);
  if (s.error) throw dbError(s.error);

  return p.data.map((plan) => ({
    id: plan.id,
    kind: plan.kind,
    accountId: plan.account_id,
    name: plan.name,
    principal: Number(plan.principal),
    feeTotal: Number(plan.fee_total),
    months: plan.months,
    payFromAccountId: plan.pay_from_account_id,
    sourceTxnId: plan.source_txn_id,
    payments: s.data
      .filter((row) => row.plan_id === plan.id)
      .map((row) => ({
        id: row.id,
        planId: row.plan_id,
        seq: row.seq,
        dueOn: row.due_on,
        amount: Number(row.amount),
        principalPart: Number(row.principal_part),
        feePart: Number(row.fee_part),
        transactionId: row.transfer_txn_id ?? row.fee_txn_id,
      })),
  }));
}

/**
 * Drops the activity of archived wallets, credit lines and loans: anything
 * moving money in or out of one, and the fees paid on its installments
 * (those sit on the wallet that paid them). Archived people keep theirs.
 * Balances and the account's own page still count all of it.
 */
export async function withoutArchived(transactions: Transaction[]): Promise<Transaction[]> {
  if (!transactions.length) return transactions;
  const supabase = await db();
  const { data: archived, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("archived", true)
    .neq("type", "person");
  if (error) throw dbError(error);
  if (!archived.length) return transactions;
  const accountIds = new Set(archived.map((a) => a.id as string));

  const { data: plans, error: planError } = await supabase
    .from("installment_plans")
    .select("id")
    .in("account_id", [...accountIds]);
  if (planError) throw dbError(planError);
  const hidden = new Set<string>();
  if (plans.length) {
    const { data: payments, error: paymentError } = await supabase
      .from("scheduled_payments")
      .select("transfer_txn_id, fee_txn_id")
      .in("plan_id", plans.map((p) => p.id as string));
    if (paymentError) throw dbError(paymentError);
    for (const p of payments) {
      if (p.transfer_txn_id) hidden.add(p.transfer_txn_id);
      if (p.fee_txn_id) hidden.add(p.fee_txn_id);
    }
  }
  return transactions.filter(
    (t) =>
      !hidden.has(t.id) && !accountIds.has(t.accountId) && !(t.toAccountId && accountIds.has(t.toAccountId)),
  );
}

/** Installments as forecast inputs: "Running shoes (2 of 3)". */
export function installmentInputs(plans: InstallmentPlan[]): NonNullable<ScheduleInputs["installments"]> {
  return plans.flatMap((plan) =>
    plan.payments.map((p) => ({
      id: p.id,
      name: plan.months > 1 ? `${plan.name} (${p.seq} of ${plan.months})` : plan.name,
      dueOn: p.dueOn,
      amount: p.amount,
      payFromAccountId: plan.payFromAccountId,
      transactionId: p.transactionId,
      lenderAccountId: plan.accountId,
      seq: p.seq,
      months: plan.months,
    })),
  );
}

/** Everyone with utang or pautang, with their entries. */
export async function getPeople({ includeArchived = false } = {}): Promise<Person[]> {
  return readPeople(includeArchived);
}

// Once per request, like readAccounts.
const readPeople = cache(async (includeArchived: boolean): Promise<Person[]> => {
  const supabase = await db();
  let accounts = supabase
    .from("accounts")
    .select("id, name, contact, starting_balance, archived")
    .eq("type", "person")
    .order("name");
  if (!includeArchived) accounts = accounts.eq("archived", false);
  const [a, b, e] = await Promise.all([
    accounts,
    supabase.from("account_balances").select("account_id, balance"),
    supabase
      .from("person_entries")
      .select("transaction_id, person_id, kind, due_on, count_in_forecast, split_total")
      .order("created_at"),
  ]);
  if (a.error) throw dbError(a.error);
  if (b.error) throw dbError(b.error);
  if (e.error) throw dbError(e.error);

  const balanceById = new Map(b.data.map((row) => [row.account_id as string, Number(row.balance)]));
  return a.data.map((p) => ({
    id: p.id,
    name: p.name,
    contact: p.contact,
    balance: balanceById.get(p.id) ?? Number(p.starting_balance),
    entries: e.data
      .filter((row) => row.person_id === p.id)
      .map((row) => ({
        transactionId: row.transaction_id,
        personId: row.person_id,
        kind: row.kind as EntryKind,
        dueOn: row.due_on,
        countInForecast: row.count_in_forecast,
        splitTotal: row.split_total === null ? null : Number(row.split_total),
      })),
  }));
});

/**
 * When the home screen widget key was made, or null when there's none.
 * `missing` means migration 0009 hasn't been run yet.
 */
export async function getWidgetKey(): Promise<{ createdAt: string } | null | "missing"> {
  const supabase = await db();
  const { data, error } = await supabase.from("widget_keys").select("created_at").maybeSingle();
  if (error?.code === "PGRST205") return "missing";
  if (error) throw dbError(error);
  return data ? { createdAt: data.created_at } : null;
}

/**
 * Grocery mode: price memory (barcode → name and latest price per store),
 * the stores you've shopped at, most recent first.
 */
export async function getPriceMemory(): Promise<{ memory: PriceMemory; stores: string[] }> {
  const supabase = await db();
  const [products, prices, trips] = await Promise.all([
    supabase.from("products").select("id, barcode, name").limit(2000),
    supabase.from("product_prices").select("product_id, store, price").order("seen_at", { ascending: false }).limit(5000),
    supabase.from("grocery_trips").select("store").order("created_at", { ascending: false }).limit(50),
  ]);
  if (products.error) throw dbError(products.error);
  if (prices.error) throw dbError(prices.error);
  if (trips.error) throw dbError(trips.error);

  const memory: PriceMemory = {};
  const byId = new Map(products.data.map((p) => [p.id, p]));
  // Newest first, so the first price seen per store is the latest.
  for (const row of prices.data) {
    const product = byId.get(row.product_id);
    if (!product) continue;
    const entry = (memory[product.barcode] ??= { name: product.name, prices: {}, last: Number(row.price) });
    entry.prices[row.store] ??= Number(row.price);
  }
  return { memory, stores: [...new Set(trips.data.map((t) => t.store as string))] };
}

export type PlanInputs = {
  accounts: Account[];
  /** Spending money in cash, bank and e-wallets right now. */
  inWallets: number;
  /** Savings, emergency fund and investments: yours, but not counted. */
  setAside: number;
  payday: RecurringItem | null;
  /** Everyone with utang or pautang. */
  people: Person[];
  /** Paydays, recurring and planned items, installments and utang from today for `days` days. */
  items: ForecastItem[];
};

/**
 * Pong's BNPL cap for this month, from your last few full months of income
 * and spending, and everything charged to your credit lines this month:
 * purchases on them and money moved out of them. Paying a line back doesn't
 * free up the month's cap.
 */
export async function getBnplCap(
  today: string,
  { accounts, inWallets, items }: Pick<PlanInputs, "accounts" | "inWallets" | "items">,
): Promise<BnplCap> {
  const [year, month] = today.split("-").map(Number);
  const from = dateInMonth(month > HISTORY_MONTHS ? year : year - 1, ((month - HISTORY_MONTHS + 11) % 12) + 1, 1);
  const thisMonth = monthContaining(today).start;
  const supabase = await db();
  const rows: { id: string; account_id: string; type: string; amount: number | string; occurred_on: string }[] = [];
  // A few months of transactions can be more than one page.
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, account_id, type, amount, occurred_on")
      .gte("occurred_on", from)
      .lte("occurred_on", today)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw dbError(error);
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const credit = new Set(accounts.filter((a) => a.type === "credit_line").map((a) => a.id));
  // Dollar wallets' interest counts in pesos.
  const pesos = (t: (typeof rows)[number]) => {
    const account = byId.get(t.account_id);
    return account?.currency === "USD" ? Number(t.amount) * (account.fxRate ?? 0) : Number(t.amount);
  };
  const past = rows.filter((t) => t.occurred_on < thisMonth);
  const current = rows.filter((t) => t.occurred_on >= thisMonth);
  let history: MoneyHistory = {
    income: roundCents(past.filter((t) => t.type === "income").reduce((sum, t) => sum + pesos(t), 0)),
    spending: roundCents(past.filter((t) => t.type === "expense").reduce((sum, t) => sum + pesos(t), 0)),
    months: new Set(past.map((t) => t.occurred_on.slice(0, 7))).size,
  };
  if (!history.months && current.length) {
    // No full month yet: estimate one from this month and your schedule.
    const expenses = current.filter((t) => t.type === "expense");
    const scheduled = await getScheduledTransactionIds(expenses.map((t) => t.id));
    const first = current.reduce((min, t) => (t.occurred_on < min ? t.occurred_on : min), today);
    history =
      estimateMonth({
        items,
        today,
        dayToDay: expenses.filter((t) => !scheduled.has(t.id)).reduce((sum, t) => sum + pesos(t), 0),
        daysLogged: daysBetween(first, today) + 1,
      }) ?? history;
  }
  const used = current
    .filter((t) => credit.has(t.account_id) && (t.type === "expense" || t.type === "transfer"))
    .reduce((sum, t) => sum + Number(t.amount), 0);
  return bnplCap({ history, items, start: inWallets, today, used });
}

/** Everything the forecast, Safe to spend and Due soon work from. */
export async function getPlanInputs(today: string, days: number): Promise<PlanInputs> {
  const [accounts, recurring, billPayments, planned, plans, people] = await Promise.all([
    getAccounts(),
    getRecurringItems(),
    getBillPayments(today),
    getPlannedExpenses(today),
    getInstallmentPlans(),
    getPeople(),
  ]);
  const installments = installmentInputs(plans);
  const until = addDays(today, days);
  const paydayAmounts = await payrollAmounts(recurring, today, until);
  return {
    accounts,
    inWallets: roundCents(
      accounts.filter((a) => countsAsSpending(a)).reduce((sum, a) => sum + a.balance, 0),
    ),
    // Dollar wallets count here, in pesos.
    setAside: pesoTotal(accounts.filter((a) => isSpendable(a.type) && !countsAsSpending(a))),
    payday: recurring.find((r) => r.kind === "payday") ?? null,
    people,
    items: sortItems([
      ...scheduledItems({ recurring, billPayments, planned, installments, paydayAmounts }, today, until),
      ...personItems(people, today, until),
    ]),
  };
}

/** Plan › Scheduled: every recurring and planned item, and what's coming. */
export async function getScheduled(today: string) {
  const [accounts, recurring, billPayments, planned] = await Promise.all([
    getAccounts(),
    getRecurringItems(),
    getBillPayments(today),
    getPlannedExpenses(today),
  ]);
  // 45 days covers the next occurrence of every schedule.
  const until = addDays(today, 45);
  const paydayAmounts = await payrollAmounts(recurring, today, until);
  const items = scheduledItems({ recurring, billPayments, planned, paydayAmounts }, today, until);
  return { accounts, recurring, planned, items, payroll: paydayAmounts !== undefined };
}

const TXN_BASE = "id, type, amount, account_id, to_account_id, category, note, occurred_on, created_at";
const TXN_COLUMNS = `${TXN_BASE}, split_id`;
const TXN_WITH_TIME = `${TXN_COLUMNS}, occurred_time`;
const TXN_WITH_SUB = `${TXN_WITH_TIME}, subcategory`;
const TXN_ALL = `${TXN_WITH_SUB}, to_amount`;

type TxnRow = {
  id: string;
  type: TransactionType;
  amount: number | string;
  account_id: string;
  to_account_id: string | null;
  category: string | null;
  note: string | null;
  occurred_on: string;
  created_at?: string | null;
  split_id?: string | null;
  /** "15:42:00" (migration 0014). */
  occurred_time?: string | null;
  /** Migration 0015. */
  subcategory?: string | null;
  /** Migration 0017. */
  to_amount?: number | string | null;
};

function toTransaction(r: TxnRow): Transaction {
  return {
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    accountId: r.account_id,
    toAccountId: r.to_account_id,
    toAmount: r.to_amount == null ? null : Number(r.to_amount),
    category: r.category,
    subcategory: r.subcategory ?? null,
    note: r.note,
    occurredOn: r.occurred_on,
    createdAt: r.created_at ?? null,
    occurredTime: r.occurred_time ? r.occurred_time.slice(0, 5) : null,
    splitId: r.split_id ?? null,
  };
}

type Read<T> = PromiseLike<{ data: T; error: { code?: string; message: string } | null }>;

/**
 * Reads transactions with to_amount, subcategory, occurred_time and split_id,
 * dropping each while its migration (0017, 0015, 0014, 0012) hasn't been run (42703).
 * Without the time, rows show when they were logged; without split_id,
 * splits show record by record.
 */
async function readTxns<T>(run: (columns: string) => Read<T>) {
  let result = await run(TXN_ALL);
  for (const columns of [TXN_WITH_SUB, TXN_WITH_TIME, TXN_COLUMNS, TXN_BASE]) {
    if (result.error?.code !== "42703") break;
    result = await run(columns);
  }
  return result;
}

/** Newest first. `from` and `to` are inclusive dates; `accountId` limits it to one account. */
export async function getTransactions({
  from,
  to,
  search,
  limit,
  accountId,
}: {
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  accountId?: string;
} = {}): Promise<Transaction[]> {
  // It goes into a PostgREST filter string, so only ever a uuid.
  if (accountId && !/^[0-9a-f-]{36}$/i.test(accountId)) return [];
  // Strip characters that have meaning in a PostgREST filter.
  const term = search?.replace(/[%_,.()*\\:"]/g, " ").trim();
  const supabase = await db();
  const { data, error } = await readTxns((columns) => {
    let query = supabase
      .from("transactions")
      .select(columns)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (from) query = query.gte("occurred_on", from);
    if (to) query = query.lte("occurred_on", to);
    if (accountId) query = query.or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`);
    if (term) {
      const sub = columns.includes("subcategory") ? `,subcategory.ilike.%${term}%` : "";
      query = query.or(`note.ilike.%${term}%,category.ilike.%${term}%${sub}`);
    }
    if (limit) query = query.limit(limit);
    return query;
  });
  if (error) throw dbError(error);
  return (data as unknown as TxnRow[]).map(toTransaction);
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await db();
  const { data, error } = await readTxns((columns) =>
    supabase.from("transactions").select(columns).eq("id", id).maybeSingle(),
  );
  if (error) throw dbError(error);
  return data ? toTransaction(data as unknown as TxnRow) : null;
}

/**
 * The subcategories you've typed before, by category, most used first.
 * Empty while migration 0015 hasn't been run.
 */
export async function getSubcategories(): Promise<Record<string, string[]>> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("transactions")
    .select("category, subcategory")
    .not("subcategory", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error?.code === "42703") return {};
  if (error) throw dbError(error);
  return subcategoryOptions(data);
}

/** False while migration 0012 (transactions.split_id) hasn't been run. */
export async function hasSplitIds(): Promise<boolean> {
  const supabase = await db();
  const { error } = await supabase.from("transactions").select("split_id").limit(1);
  return error?.code !== "42703";
}

/** Every record of one split bill, your share first. Empty if there's no such split. */
export async function getSplit(splitId: string): Promise<Transaction[]> {
  if (!/^[0-9a-f-]{36}$/i.test(splitId)) return [];
  const supabase = await db();
  const { data, error } = await supabase
    .from("transactions")
    .select(TXN_COLUMNS)
    .eq("split_id", splitId)
    .order("created_at");
  if (error?.code === "42703") return [];
  if (error) throw dbError(error);
  const rows = (data as unknown as TxnRow[]).map(toTransaction);
  return [...rows.filter((t) => t.type === "expense"), ...rows.filter((t) => t.type !== "expense")];
}

/**
 * The split bills paid from one wallet or credit line, by split id: every
 * record, your share first. Empty while migration 0012 hasn't been run.
 */
export async function getSplitsPaidWith(accountId: string): Promise<Map<string, Transaction[]>> {
  const splits = new Map<string, Transaction[]>();
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return splits;
  const supabase = await db();
  const { data, error } = await supabase
    .from("transactions")
    .select(TXN_COLUMNS)
    .eq("account_id", accountId)
    .not("split_id", "is", null)
    .order("created_at");
  if (error?.code === "42703") return splits;
  if (error) throw dbError(error);
  for (const t of (data as unknown as TxnRow[]).map(toTransaction)) {
    const list = splits.get(t.splitId!) ?? [];
    if (t.type === "expense") list.unshift(t);
    else list.push(t);
    splits.set(t.splitId!, list);
  }
  return splits;
}

/**
 * The expenses, income and transfers you log most often lately, most
 * frequent first. Amount, category, wallet and note must all match.
 */
export function templatesFrom(recent: Transaction[], walletIds: Set<string>, max = 4): Template[] {
  const seen = new Map<string, { template: Template; count: number; order: number }>();
  recent.forEach((t, order) => {
    if (!walletIds.has(t.accountId) || t.category === "adjustment") return;
    // Pesos to dollars depends on the day's rate: type it each time.
    if (t.toAmount !== null) return;
    if (t.toAccountId && !walletIds.has(t.toAccountId)) return;
    const key = [t.type, t.amount, t.category, t.subcategory ?? "", t.accountId, t.toAccountId, t.note ?? ""].join("|");
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else {
      const template: Template = {
        type: t.type,
        amount: t.amount,
        accountId: t.accountId,
        toAccountId: t.toAccountId,
        toAmount: null,
        category: t.category,
        subcategory: t.subcategory,
        note: t.note,
      };
      seen.set(key, { template, count: 1, order });
    }
  });
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, max)
    .map((s) => s.template);
}

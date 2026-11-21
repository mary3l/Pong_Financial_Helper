import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { categoryInfo } from "@/lib/categories";
import { loanSchedule } from "@/lib/installments";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  addCreditLine,
  addLoan,
  addPurchasesToBill,
  addUpcomingPayments,
  deleteLoanForGood,
  fixBillDates,
  payInstallments,
  removePlan,
  undoInstallment,
  updateCreditLine,
  updateLoan,
  updatePlan,
  type CreditLineInput,
  type LoanInput,
  type LoanUpdate,
  type PlanEdit,
  type UpcomingInput,
} from "./credit-actions";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: FakeSupabase;
function useDb(
  seed?: Parameters<typeof fakeSupabase>[0],
  opts?: Parameters<typeof fakeSupabase>[1],
) {
  db = fakeSupabase(seed, opts);
  vi.mocked(createClient).mockResolvedValue(db.client);
  return db;
}

const FAILED = { error: "Couldn't save that. Please try again." };
const LINE = "11111111-1111-1111-1111-111111111111";
const LOAN = "22222222-2222-2222-2222-222222222222";

const wallets = [
  { id: "cash", type: "cash", archived: false, currency: "PHP", created_at: "1" },
  { id: "bank", type: "bank", archived: false, currency: "PHP", created_at: "2" },
  { id: "usd", type: "bank", archived: false, currency: "USD", created_at: "3" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
  useDb();
});
afterEach(() => vi.useRealTimers());

describe("addCreditLine", () => {
  const line: CreditLineInput = {
    name: "  SPay   Later ",
    limit: 15000.456,
    dueDay: 5,
    cutoffDay: 15,
    used: 1500.5,
  };

  it.each<[string, Partial<CreditLineInput>, string]>([
    ["no name", { name: "   " }, "Give it a name, like SPayLater."],
    ["long name", { name: "x".repeat(61) }, "Keep the name to 60 characters."],
    ["zero limit", { limit: 0 }, "Check the credit limit, or leave it blank."],
    ["due day 32", { dueDay: 32 }, "Pick the day the bill is due."],
    ["cutoff day 0", { cutoffDay: 0 }, "Pick the day the statement cuts off."],
    [
      "cutoff without due day",
      { dueDay: null },
      "Pick the day the bill is due too, so I know when each statement is paid.",
    ],
    ["negative owed", { used: -1 }, "Check how much you owe on it now."],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await addCreditLine({ ...line, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the signed-out error when there's no session", async () => {
    useDb({}, { user: null });
    expect(await addCreditLine(line)).toEqual({ error: SIGNED_OUT_ERROR });
    expect(db.writeLog()).toEqual([]);
  });

  it("inserts the line with what you owe as a negative starting balance", async () => {
    const result = await addCreditLine(line);
    const [row] = db.table("accounts");
    expect(result).toEqual({ id: row.id });
    expect(db.writes("accounts", "insert")).toEqual([
      {
        name: "SPay Later",
        type: "credit_line",
        credit_limit: 15000.46,
        due_day: 5,
        cutoff_day: 15,
        starting_balance: -1500.5,
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("won't drop a cutoff day before migration 0019", async () => {
    db.respond((q) =>
      q.table === "accounts" ? fail("PGRST204", "column 'cutoff_day'") : undefined,
    );
    expect((await addCreditLine(line)).error).toMatch(/run step 19/);
    expect(db.writes("accounts", "insert")).toHaveLength(1);
  });

  it("retries without cutoff_day before migration 0019 when there's none", async () => {
    let first = true;
    db.respond((q) => {
      if (q.table === "accounts" && q.op === "insert" && first) {
        first = false;
        return fail("42703", "column cutoff_day does not exist");
      }
    });
    expect(await addCreditLine({ ...line, cutoffDay: null })).toEqual({
      id: expect.any(String),
    });
    const [, retry] = db.writes("accounts", "insert") as Record<string, unknown>[];
    expect(retry).not.toHaveProperty("cutoff_day");
    expect(retry).toMatchObject({ name: "SPay Later", due_day: 5 });
  });

  it("fails when the insert fails", async () => {
    db.respond((q) => (q.table === "accounts" ? fail() : undefined));
    expect(await addCreditLine(line)).toEqual(FAILED);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("updateCreditLine", () => {
  const input: CreditLineInput = {
    name: "Atome",
    limit: null,
    dueDay: 5,
    cutoffDay: 15,
    used: 2000,
  };

  it("rejects bad input before signing in", async () => {
    expect(await updateCreditLine(LINE, { ...input, name: "" })).toEqual({
      error: "Give it a name, like SPayLater.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs an existing credit line", async () => {
    useDb({ accounts: [{ id: LINE, type: "bank", starting_balance: 0 }] });
    expect(await updateCreditLine(LINE, input)).toEqual({
      error: "Couldn't find that credit line.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("moves the starting balance so the balance becomes what you owe", async () => {
    useDb({
      accounts: [{ id: LINE, type: "credit_line", starting_balance: -1000, due_day: null }],
      // -1000 starting, -500 of purchases logged.
      account_balances: [{ account_id: LINE, balance: -1500 }],
    });
    expect(await updateCreditLine(LINE, input)).toEqual({});
    // -1000 + (-2000 - -1500) = -1500
    expect(db.writes("accounts", "update")).toEqual([
      { name: "Atome", credit_limit: null, due_day: 5, cutoff_day: 15, starting_balance: -1500 },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("moves a purchase to the bill the new cutoff puts it on", async () => {
    useDb({
      accounts: [{ id: LINE, type: "credit_line", starting_balance: 0, due_day: 5 }],
      account_balances: [{ account_id: LINE, balance: -900 }],
      ...misdatedSeed(),
    });
    expect(await updateCreditLine(LINE, { ...input, used: 900 })).toEqual({});
    expectRedated();
  });
});

/** A 3-month purchase bought 2026-11-10, wrongly on the January bill. */
function misdatedSeed() {
  return {
    installment_plans: [
      { id: "plan-1", account_id: LINE, name: "Shoes", months: 3, source_txn_id: "buy-1" },
      // Added by hand: no purchase, so never moved.
      { id: "plan-2", account_id: LINE, name: "Bill", months: 1, source_txn_id: null },
    ],
    scheduled_payments: [
      {
        id: "sp-1",
        plan_id: "plan-1",
        seq: 1,
        due_on: "2027-01-05",
        transfer_txn_id: null,
        fee_txn_id: null,
      },
      {
        id: "sp-2",
        plan_id: "plan-1",
        seq: 2,
        due_on: "2027-02-05",
        transfer_txn_id: null,
        fee_txn_id: null,
      },
      {
        id: "sp-3",
        plan_id: "plan-1",
        seq: 3,
        due_on: "2027-03-05",
        transfer_txn_id: null,
        fee_txn_id: null,
      },
      {
        id: "sp-9",
        plan_id: "plan-2",
        seq: 1,
        due_on: "2027-01-05",
        transfer_txn_id: null,
        fee_txn_id: null,
      },
    ],
    transactions: [{ id: "buy-1", occurred_on: "2026-11-10" }],
  };
}

function expectRedated() {
  // Cutoff 15 closes the 2026-11-15 statement, due on the 5th after it.
  expect(db.writes("scheduled_payments", "update")).toEqual([
    { due_on: "2026-12-05" },
    { due_on: "2027-01-05" },
    { due_on: "2027-02-05" },
  ]);
  expect(db.writes("installment_plans", "update")).toEqual([{ first_due: "2026-12-05" }]);
  expect(db.table("scheduled_payments").find((p) => p.id === "sp-9")).toMatchObject({
    due_on: "2027-01-05",
  });
}

describe("fixBillDates", () => {
  const line = { id: LINE, type: "credit_line", due_day: 5, cutoff_day: 15 };

  it("only takes a plain id", async () => {
    expect(await fixBillDates("x),id.neq.0")).toEqual({ error: "Couldn't find that credit line." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await fixBillDates(LINE)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("moves unpaid purchases to the bill their cutoff puts them on", async () => {
    useDb({ accounts: [line], ...misdatedSeed() });
    expect(await fixBillDates(LINE)).toEqual({});
    expectRedated();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("leaves a purchase alone once a payment is made", async () => {
    const seed = misdatedSeed();
    seed.scheduled_payments[1] = {
      ...seed.scheduled_payments[1],
      transfer_txn_id: "pay-1",
    } as never;
    useDb({ accounts: [line], ...seed });
    expect(await fixBillDates(LINE)).toEqual({});
    expect(db.writeLog()).toEqual([]);
  });

  it("fails for an account that isn't a credit line", async () => {
    useDb({ accounts: [{ ...line, type: "loan" }] });
    expect(await fixBillDates(LINE)).toEqual(FAILED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("fails when a payment can't be moved", async () => {
    useDb({ accounts: [line], ...misdatedSeed() });
    db.respond((q) => (q.table === "scheduled_payments" && q.op === "update" ? fail() : undefined));
    expect(await fixBillDates(LINE)).toEqual(FAILED);
    expect(db.writes("installment_plans", "update")).toEqual([]);
  });
});

describe("addUpcomingPayments", () => {
  const input: UpcomingInput = {
    name: "  ",
    amount: 550,
    fee: 50,
    firstDue: "2026-12-15",
    months: 6,
    alreadyPaid: 2,
    addToOwed: true,
  };
  const line = { id: LINE, type: "credit_line", starting_balance: -1000 };

  it.each<[string, Partial<UpcomingInput>, string]>([
    ["long name", { name: "x".repeat(61) }, "Keep the name to 60 characters."],
    ["zero amount", { amount: 0 }, "Enter how much you'll pay."],
    [
      "fee as big as the payment",
      { fee: 550 },
      "The interest or fee has to be less than the payment.",
    ],
    ["negative fee", { fee: -1 }, "The interest or fee has to be less than the payment."],
    ["37 months", { months: 37 }, "Pick how many months."],
    ["all already paid", { alreadyPaid: 6 }, "Check how many payments you've already made."],
    ["bad date", { firstDue: "2026-13-01" }, "Pick when it's due."],
    ["too big in total", { amount: 999_999_999_999, fee: 0 }, "That amount is too big."],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await addUpcomingPayments(LINE, { ...input, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a credit line", async () => {
    useDb({ accounts: [{ ...line, type: "bank" }] });
    expect(await addUpcomingPayments(LINE, input)).toEqual({
      error: "Couldn't find that credit line.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("saves the payments left and adds their principal to what you owe", async () => {
    useDb({ accounts: [line] });
    expect(await addUpcomingPayments(LINE, input)).toEqual({});
    const [plan] = db.table("installment_plans");
    expect(db.writes("installment_plans", "insert")).toEqual([
      {
        kind: "bnpl",
        account_id: LINE,
        name: "Upcoming bill",
        principal: 3000,
        fee_total: 200,
        months: 6,
        first_due: "2026-12-15",
        pay_from_account_id: null,
        source_txn_id: null,
      },
    ]);
    expect(db.writes("scheduled_payments", "insert")).toEqual([
      ["2026-12-15", "2027-01-15", "2027-02-15", "2027-03-15"].map((due_on, i) => ({
        plan_id: plan.id,
        seq: i + 3,
        due_on,
        amount: 550,
        principal_part: 500,
        fee_part: 50,
      })),
    ]);
    // 4 payments left × 500 principal.
    expect(db.writes("accounts", "update")).toEqual([{ starting_balance: -3000 }]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("leaves what you owe alone when it's already counted", async () => {
    useDb({ accounts: [line] });
    expect(await addUpcomingPayments(LINE, { ...input, addToOwed: false })).toEqual({});
    expect(db.writes("accounts")).toEqual([]);
  });

  it("removes the plan when what you owe can't be updated", async () => {
    useDb({ accounts: [line] });
    db.respond((q) => (q.table === "accounts" && q.op === "update" ? fail() : undefined));
    expect(await addUpcomingPayments(LINE, input)).toEqual(FAILED);
    expect(db.writeLog()).toEqual([
      "insert installment_plans",
      "insert scheduled_payments",
      "update accounts",
      "delete installment_plans",
    ]);
    expect(db.table("installment_plans")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("addLoan", () => {
  const loan: LoanInput = {
    name: " SLoan ",
    received: 10000,
    intoAccountId: "bank",
    receivedOn: "2026-11-10",
    monthly: 1000,
    months: 12,
    nextDue: "2026-12-15",
    payFromAccountId: "bank",
    alreadyPaid: 0,
  };

  it.each<[string, Partial<LoanInput>, string]>([
    ["no name", { name: "" }, "Give the loan a name, like SLoan."],
    ["nothing received", { received: 0 }, "Enter the amount you received."],
    ["no monthly", { monthly: Number.NaN }, "Enter the monthly payment."],
    ["61 months", { months: 61 }, "Pick how many months."],
    [
      "payments below what you got",
      { monthly: 800 },
      "The payments add up to less than you received. Check the monthly payment and months.",
    ],
    ["bad next due", { nextDue: "soon" }, "Pick when the next payment is due."],
    ["bad received date", { receivedOn: "" }, "Pick the day you received it."],
    [
      "payments made on a loan just received",
      { alreadyPaid: 2 },
      "A loan you just received has no payments yet. Set payments made to 0.",
    ],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await addLoan({ ...loan, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await addLoan(loan)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("saves the loan, the money in as a transfer and its schedule", async () => {
    const result = await addLoan(loan);
    const [account] = db.table("accounts");
    const [txn] = db.table("transactions");
    expect(result).toEqual({ id: account.id });
    expect(db.writes("accounts", "insert")).toEqual([
      { name: "SLoan", type: "loan", starting_balance: 0 },
    ]);
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 10000,
        account_id: account.id,
        to_account_id: "bank",
        note: "SLoan received",
        occurred_on: "2026-11-10",
      },
    ]);
    expect(db.writes("installment_plans", "insert")).toEqual([
      expect.objectContaining({
        kind: "loan",
        account_id: account.id,
        principal: 10000,
        // 12 × 1000 paid back on 10000.
        fee_total: 2000,
        months: 12,
        first_due: "2026-12-15",
        pay_from_account_id: "bank",
        source_txn_id: txn.id,
      }),
    ]);
    const payments = db.table("scheduled_payments");
    expect(payments).toHaveLength(12);
    // 10000 / 12: 833.33 each, the last absorbing the rounding.
    expect(payments[0]).toMatchObject({
      seq: 1,
      principal_part: 833.33,
      fee_part: 166.67,
      amount: 1000,
    });
    expect(payments[11]).toMatchObject({
      seq: 12,
      due_on: "2027-11-15",
      principal_part: 833.37,
      fee_part: 166.63,
      amount: 1000,
    });
  });

  it("starts a loan you were already paying at what's still owed", async () => {
    expect(await addLoan({ ...loan, intoAccountId: null, alreadyPaid: 3 })).toEqual({
      id: expect.any(String),
    });
    // 8 × 833.33 + 833.37 still owed.
    expect(db.writes("accounts", "insert")).toEqual([
      { name: "SLoan", type: "loan", starting_balance: -7500.01 },
    ]);
    expect(db.writes("transactions")).toEqual([]);
    expect(db.writes("installment_plans", "insert")).toEqual([
      expect.objectContaining({ source_txn_id: null, principal: 10000 }),
    ]);
    const payments = db.table("scheduled_payments");
    expect(payments.map((p) => p.seq)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(payments[0].due_on).toBe("2026-12-15");
  });

  it("removes the loan account when the money in can't be saved", async () => {
    db.respond((q) => (q.table === "transactions" ? fail() : undefined));
    expect(await addLoan(loan)).toEqual(FAILED);
    expect(db.writeLog()).toEqual(["insert accounts", "insert transactions", "delete accounts"]);
    expect(db.table("accounts")).toEqual([]);
  });

  it("removes the transfer and the account when the plan can't be saved", async () => {
    db.respond((q) => (q.table === "installment_plans" ? fail() : undefined));
    expect(await addLoan(loan)).toEqual(FAILED);
    expect(db.table("transactions")).toEqual([]);
    expect(db.table("accounts")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("updateLoan", () => {
  const update: LoanUpdate = {
    name: "SLoan v2",
    received: 12000,
    monthly: 1200,
    months: 12,
    nextDue: "2027-02-15",
    payFromAccountId: "bank",
  };
  const plan = {
    id: "plan-1",
    account_id: LOAN,
    kind: "loan",
    source_txn_id: "t-in",
    person_id: null,
    created_at: "1",
  };
  /** The saved 10000 / 12 × 1000 schedule from 2026-12-15, the first `paid` of it paid. */
  function schedule(paid: number) {
    return loanSchedule({ received: 10000, monthly: 1000, months: 12 }, "2026-12-15").map(
      (r, i) => ({
        id: `sp-${r.seq}`,
        plan_id: "plan-1",
        seq: r.seq,
        due_on: r.dueOn,
        amount: r.amount,
        principal_part: r.principalPart,
        fee_part: r.feePart,
        transfer_txn_id: i < paid ? `pay-${r.seq}` : null,
        fee_txn_id: i < paid ? `fee-${r.seq}` : null,
      }),
    );
  }
  const seed = (paid = 2, planPatch: Record<string, unknown> = {}) => ({
    accounts: [{ id: LOAN, type: "loan", starting_balance: 0 }, ...wallets],
    installment_plans: [{ ...plan, ...planPatch }],
    scheduled_payments: schedule(paid),
    transactions: [
      { id: "t-in", type: "transfer", amount: 10000, account_id: LOAN, to_account_id: "bank" },
    ],
  });

  it.each<[string, Partial<LoanUpdate>, string]>([
    ["no name", { name: " " }, "Give the loan a name, like SLoan."],
    ["long name", { name: "x".repeat(61) }, "Keep the name to 60 characters."],
    ["zero amount", { received: 0 }, "Enter the loan amount."],
    ["no monthly", { monthly: -1 }, "Enter the monthly payment."],
    ["0 months", { months: 0 }, "Pick how many months."],
    ["bad next due", { nextDue: "2027-02-30" }, "Pick when the next payment is due."],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await updateLoan(LOAN, { ...update, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("only edits loans", async () => {
    useDb({ accounts: [{ id: LOAN, type: "credit_line" }] });
    expect(await updateLoan(LOAN, update)).toEqual({ error: "Couldn't find that loan." });
  });

  it("only pays from a wallet you spend from", async () => {
    useDb({
      accounts: [
        { id: LOAN, type: "loan" },
        { id: "spl", type: "credit_line" },
      ],
    });
    expect(await updateLoan(LOAN, { ...update, payFromAccountId: "spl" })).toEqual({
      error: "Pay from cash, a bank or an e-wallet.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("only renames a loan whose plan was removed", async () => {
    useDb({ accounts: [{ id: LOAN, type: "loan" }, ...wallets] });
    expect(await updateLoan(LOAN, update)).toEqual({});
    expect(db.writeLog()).toEqual(["update accounts"]);
    expect(db.writes("accounts", "update")).toEqual([{ name: "SLoan v2" }]);
  });

  it("swaps the unpaid payments and changes the transfer that brought it in", async () => {
    useDb(seed());
    expect(await updateLoan(LOAN, update)).toEqual({});

    const deleted = db.queries.find((q) => q.table === "scheduled_payments" && q.op === "delete")!;
    expect(deleted.filters).toEqual([
      {
        method: "in",
        args: [
          "id",
          ["sp-3", "sp-4", "sp-5", "sp-6", "sp-7", "sp-8", "sp-9", "sp-10", "sp-11", "sp-12"],
        ],
      },
    ]);
    const [rows] = db.writes("scheduled_payments", "insert") as Record<string, unknown>[][];
    expect(rows.map((r) => r.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[0]).toMatchObject({ plan_id: "plan-1", due_on: "2027-02-15" });
    // 12000 owed less the 2 × 833.33 already paid.
    const principal = rows.reduce((sum, r) => sum + Number(r.principal_part), 0);
    expect(Math.round(principal * 100) / 100).toBe(10333.34);

    expect(db.writes("installment_plans", "update")).toEqual([
      expect.objectContaining({
        name: "SLoan v2",
        principal: 12000,
        months: 12,
        first_due: "2026-12-15",
        pay_from_account_id: "bank",
      }),
    ]);
    expect(db.writes("installment_plans", "update")[0]).not.toHaveProperty("source_txn_id");
    expect(db.writes("accounts", "update")).toEqual([{ name: "SLoan v2" }]);
    expect(db.writes("transactions", "update")).toEqual([{ amount: 12000 }]);
    expect(db.table("transactions")[0]).toMatchObject({ id: "t-in", amount: 12000 });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("won't take payments made before on a loan whose money came in here", async () => {
    useDb(seed());
    expect(await updateLoan(LOAN, { ...update, paidBefore: 2 })).toEqual({
      error: "This loan's money came in here, so there are no payments from before.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("puts the old payments back when the new ones can't be saved", async () => {
    useDb(seed());
    let first = true;
    db.respond((q) => {
      if (q.table === "scheduled_payments" && q.op === "insert" && first) {
        first = false;
        return fail();
      }
    });
    expect(await updateLoan(LOAN, update)).toEqual(FAILED);
    const [, restored] = db.writes("scheduled_payments", "insert") as Record<string, unknown>[][];
    expect(restored).toEqual(
      schedule(2)
        .slice(2)
        .map((p) => ({
          plan_id: "plan-1",
          seq: p.seq,
          due_on: p.due_on,
          amount: p.amount,
          principal_part: p.principal_part,
          fee_part: p.fee_part,
        })),
    );
    expect(db.writes("installment_plans", "update")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes the transfer back out for a loan you already had", async () => {
    useDb(seed(0));
    expect(
      await updateLoan(LOAN, { ...update, received: 10000, monthly: 1000, alreadyHad: true }),
    ).toEqual({});
    expect(db.writes("installment_plans", "update")).toEqual([
      expect.objectContaining({ source_txn_id: null }),
    ]);
    expect(db.table("transactions")).toEqual([]);
    expect(db.writes("accounts", "update")).toEqual([
      { name: "SLoan v2" },
      { starting_balance: -10000 },
    ]);
  });

  it("moves what they owe you on a loan someone else pays", async () => {
    useDb({
      ...seed(0, { source_txn_id: null, person_id: "p1" }),
      transactions: [
        { id: "lend", type: "transfer", amount: 10000, account_id: LOAN, to_account_id: "p1" },
      ],
      person_entries: [{ id: "pe-1", transaction_id: "lend", due_on: "2027-11-15" }],
    });
    expect(await updateLoan(LOAN, update)).toEqual({});
    // Principal 10000 → 12000: they owe 2000 more.
    expect(db.table("transactions")[0]).toMatchObject({ id: "lend", amount: 12000 });
    expect(db.writes("installment_plans", "update")).toEqual([
      expect.objectContaining({ pay_from_account_id: null }),
    ]);
    expect(db.writes("accounts", "update")).toEqual([{ name: "SLoan v2" }]);
    // Due by the last payment: 12 months from 2027-02-15.
    expect(db.writes("person_entries", "update")).toEqual([{ due_on: "2028-01-15" }]);
  });
});

describe("payInstallments", () => {
  const plans = [
    { id: "plan-1", account_id: "spl", name: "Shoes", months: 6, pay_from_account_id: "bank" },
    { id: "plan-2", account_id: "spl", name: "Meralco", months: 1, pay_from_account_id: null },
  ];
  const payments = [
    {
      id: "sp-1",
      plan_id: "plan-1",
      seq: 3,
      principal_part: 500,
      fee_part: 50,
      transfer_txn_id: null,
      fee_txn_id: null,
    },
    {
      id: "sp-2",
      plan_id: "plan-2",
      seq: 1,
      principal_part: 2400,
      fee_part: 0,
      transfer_txn_id: null,
      fee_txn_id: null,
    },
    {
      id: "sp-3",
      plan_id: "plan-1",
      seq: 2,
      principal_part: 500,
      fee_part: 50,
      transfer_txn_id: "old",
      fee_txn_id: null,
    },
  ];
  const seed = () => ({
    accounts: [...wallets, { id: "spl", type: "credit_line", archived: false, currency: "PHP" }],
    installment_plans: plans,
    scheduled_payments: payments,
  });

  it("does nothing for no ids", async () => {
    expect(await payInstallments([])).toEqual({});
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb(seed(), { user: null });
    expect(await payInstallments(["sp-1"])).toEqual({ error: SIGNED_OUT_ERROR });
    expect(db.writeLog()).toEqual([]);
  });

  it("says so when the payment isn't there", async () => {
    expect(await payInstallments(["gone"])).toEqual({ error: "Couldn't find that payment." });
  });

  it("only pays from a wallet you spend from", async () => {
    useDb(seed());
    expect(await payInstallments(["sp-1"], "spl")).toEqual({
      error: "Pay from cash, a bank or an e-wallet.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("logs the principal as a transfer and the fee as an expense today", async () => {
    useDb(seed());
    expect(await payInstallments(["sp-1"])).toEqual({});
    const [transfer, fee] = db.table("transactions");
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 500,
        account_id: "bank",
        to_account_id: "spl",
        note: "Shoes 3 of 6",
        occurred_on: "2026-11-19",
      },
      {
        type: "expense",
        amount: 50,
        account_id: "bank",
        category: "fees",
        note: "Shoes 3 of 6 · fee",
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("scheduled_payments", "update")).toEqual([
      { transfer_txn_id: transfer.id, fee_txn_id: fee.id },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("skips a paid one and uses the chosen wallet or the first one", async () => {
    useDb(seed());
    expect(await payInstallments(["sp-2", "sp-3"])).toEqual({});
    // A single bill has no fee and is noted by its name; no saved wallet → first peso wallet.
    expect(db.writes("transactions", "insert")).toEqual([
      expect.objectContaining({ amount: 2400, account_id: "cash", note: "Meralco" }),
    ]);
    expect(db.writes("scheduled_payments", "update")).toEqual([
      { transfer_txn_id: expect.any(String), fee_txn_id: null },
    ]);

    useDb(seed());
    expect(await payInstallments(["sp-1"], "cash")).toEqual({});
    expect(db.writes("transactions", "insert")).toEqual([
      expect.objectContaining({ account_id: "cash" }),
      expect.objectContaining({ account_id: "cash" }),
    ]);
  });

  it("asks for a wallet when there's none", async () => {
    useDb({ ...seed(), accounts: [{ id: "spl", type: "credit_line", archived: false }] });
    expect(await payInstallments(["sp-1"])).toEqual({
      error: "Add a wallet first, so I know where the money comes from.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("removes the transfer when the fee can't be saved", async () => {
    useDb(seed());
    db.respond((q) =>
      q.table === "transactions" &&
      q.op === "insert" &&
      (q.payload as Record<string, unknown>).type === "expense"
        ? fail()
        : undefined,
    );
    expect(await payInstallments(["sp-1"])).toEqual(FAILED);
    expect(db.table("transactions")).toEqual([]);
    expect(db.writes("scheduled_payments")).toEqual([]);
  });

  it("doesn't count it twice when it was paid in another tab", async () => {
    useDb(seed());
    db.respond((q) =>
      q.table === "scheduled_payments" && q.op === "update" ? { data: [], error: null } : undefined,
    );
    expect(await payInstallments(["sp-1"])).toEqual({});
    expect(db.table("transactions")).toEqual([]);
    const update = db.queries.find((q) => q.table === "scheduled_payments" && q.op === "update")!;
    expect(update.filters).toEqual(
      expect.arrayContaining([
        { method: "is", args: ["transfer_txn_id", null] },
        { method: "is", args: ["fee_txn_id", null] },
      ]),
    );
  });
});

describe("undoInstallment", () => {
  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await undoInstallment("sp-1")).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("deletes the payment's transfer and fee", async () => {
    useDb({
      scheduled_payments: [{ id: "sp-1", transfer_txn_id: "t1", fee_txn_id: "t2" }],
      transactions: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
    });
    expect(await undoInstallment("sp-1")).toEqual({});
    expect(db.table("transactions")).toEqual([{ id: "t3" }]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does nothing for an unpaid payment", async () => {
    useDb({ scheduled_payments: [{ id: "sp-1", transfer_txn_id: null, fee_txn_id: null }] });
    expect(await undoInstallment("sp-1")).toEqual({});
    expect(db.writeLog()).toEqual([]);
  });

  it("says so when the delete fails", async () => {
    useDb({ scheduled_payments: [{ id: "sp-1", transfer_txn_id: "t1", fee_txn_id: null }] });
    db.respond((q) => (q.op === "delete" ? fail() : undefined));
    expect(await undoInstallment("sp-1")).toEqual({
      error: "Couldn't undo that. Please try again.",
    });
  });
});

describe("updatePlan", () => {
  const edit: PlanEdit = {
    name: " Atome bill ",
    amount: 600,
    nextDue: "2027-01-10",
    adjustOwed: true,
  };
  const payments = [
    {
      id: "sp-1",
      plan_id: "plan-1",
      seq: 1,
      due_on: "2026-11-05",
      amount: 550,
      principal_part: 500,
      fee_part: 50,
      transfer_txn_id: "paid",
      fee_txn_id: null,
    },
    {
      id: "sp-2",
      plan_id: "plan-1",
      seq: 2,
      due_on: "2026-12-05",
      amount: 550,
      principal_part: 500,
      fee_part: 50,
      transfer_txn_id: null,
      fee_txn_id: null,
    },
    {
      id: "sp-3",
      plan_id: "plan-1",
      seq: 3,
      due_on: "2027-01-05",
      amount: 550,
      principal_part: 500,
      fee_part: 50,
      transfer_txn_id: null,
      fee_txn_id: null,
    },
  ];
  const seed = (source: string | null = null, kind = "bnpl") => ({
    accounts: [{ id: LINE, type: "credit_line", starting_balance: -1000 }],
    installment_plans: [{ id: "plan-1", kind, account_id: LINE, source_txn_id: source }],
    scheduled_payments: payments,
  });

  it.each<[string, Partial<PlanEdit>, string]>([
    ["no name", { name: "" }, "Give it a name."],
    ["long name", { name: "x".repeat(61) }, "Keep the name to 60 characters."],
    ["zero amount", { amount: 0 }, "Enter how much you'll pay."],
    ["bad date", { nextDue: "2027-1-10" }, "Pick when it's due."],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await updatePlan("plan-1", { ...edit, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("only edits BNPL plans", async () => {
    useDb(seed(null, "loan"));
    expect(await updatePlan("plan-1", edit)).toEqual({ error: "Couldn't find that plan." });
    expect(db.writeLog()).toEqual([]);
  });

  it("changes a bill added by hand: the unpaid amounts, dates and what you owe", async () => {
    useDb(seed());
    expect(await updatePlan("plan-1", edit)).toEqual({});
    expect(db.writes("scheduled_payments", "update")).toEqual([
      { amount: 600, principal_part: 550, due_on: "2027-01-10" },
      { amount: 600, principal_part: 550, due_on: "2027-02-10" },
    ]);
    expect(db.writes("installment_plans", "update")).toEqual([
      // 500 paid + 2 × 550 left; the paid one is still the first due.
      { name: "Atome bill", principal: 1600, first_due: "2026-11-05" },
    ]);
    // Owe 2 × 50 more.
    expect(db.writes("accounts", "update")).toEqual([{ starting_balance: -1100 }]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("only renames a purchase's plan", async () => {
    useDb(seed("buy-1"));
    expect(await updatePlan("plan-1", edit)).toEqual({});
    expect(db.writes("scheduled_payments")).toEqual([]);
    expect(db.writes("installment_plans", "update")).toEqual([
      { name: "Atome bill", principal: 1500, first_due: "2026-11-05" },
    ]);
    expect(db.writes("accounts")).toEqual([]);
  });

  it("won't make a payment smaller than its fee", async () => {
    useDb(seed());
    expect(await updatePlan("plan-1", { ...edit, amount: 50 })).toEqual({
      error: "The payment has to be more than its fee.",
    });
    expect(db.writeLog()).toEqual([]);
  });
});

describe("removePlan", () => {
  it("deletes the plan", async () => {
    useDb({ installment_plans: [{ id: "plan-1" }, { id: "plan-2" }] });
    expect(await removePlan("plan-1")).toEqual({});
    expect(db.table("installment_plans")).toEqual([{ id: "plan-2" }]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("fails when nothing was deleted", async () => {
    expect(await removePlan("gone")).toEqual({
      error: "Couldn't remove that plan. Please try again.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  const fromPurchase = (payment: Record<string, unknown>, txn: Record<string, unknown>) => ({
    installment_plans: [{ id: "plan-1", source_txn_id: "txn-1" }],
    scheduled_payments: [
      { id: "sp-1", plan_id: "plan-1", transfer_txn_id: null, fee_txn_id: null, ...payment },
    ],
    transactions: [{ id: "txn-1", type: "expense", split_id: null, ...txn }],
  });

  it("deletes the purchase of an unpaid bill made from one", async () => {
    useDb(fromPurchase({}, {}));
    expect(await removePlan("plan-1")).toEqual({});
    // The purchase goes; the database removes its plan with it (on delete cascade).
    expect(db.table("transactions")).toEqual([]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the purchase once a payment is made", async () => {
    useDb(fromPurchase({ transfer_txn_id: "pay-1" }, {}));
    expect(await removePlan("plan-1")).toEqual({});
    expect(db.table("installment_plans")).toEqual([]);
    expect(db.table("transactions")).toHaveLength(1);
  });

  it("keeps a split bill's purchase", async () => {
    useDb(fromPurchase({}, { split_id: "s1" }));
    expect(await removePlan("plan-1")).toEqual({});
    expect(db.table("installment_plans")).toEqual([]);
    expect(db.table("transactions")).toHaveLength(1);
  });
});

describe("addPurchasesToBill", () => {
  // Atome: due on the 16th, statement cut on the 6th.
  const line = { id: LINE, type: "credit_line", due_day: 16, cutoff_day: 6 };
  const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  const purchase = (n: number, over: Record<string, unknown>) => ({
    id: id(n),
    type: "expense",
    account_id: LINE,
    amount: 100,
    category: "food",
    note: null,
    subcategory: null,
    occurred_on: "2026-11-07",
    split_id: null,
    ...over,
  });
  const seed = () => ({
    accounts: [line],
    transactions: [
      purchase(1, { amount: 808.5, note: "Groceries · Gmall", category: "groceries" }),
      purchase(2, { amount: 59, subcategory: "Maxim", category: "transpo" }),
      purchase(3, {}),
      purchase(4, { split_id: "s1" }),
      purchase(5, {}),
    ],
    installment_plans: [{ id: "plan-5", source_txn_id: id(5) }],
  });
  const all = [1, 2, 3, 4, 5].map(id);

  it("only takes plain ids", async () => {
    expect(await addPurchasesToBill(LINE, [])).toEqual({ error: "Couldn't find those purchases." });
    expect(await addPurchasesToBill(LINE, ["x),id.neq.0"])).toEqual({
      error: "Couldn't find those purchases.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await addPurchasesToBill(LINE, all)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("puts each purchase on the bill it lands on, skipping splits and ones on a bill", async () => {
    useDb(seed());
    expect(await addPurchasesToBill(LINE, all)).toEqual({});
    const bill = (name: string, principal: number, n: number) => ({
      name,
      principal,
      months: 1,
      first_due: "2026-12-16",
      source_txn_id: id(n),
    });
    expect(db.writes("installment_plans", "insert")).toMatchObject([
      bill("Groceries · Gmall", 808.5, 1),
      bill("Maxim", 59, 2),
      bill(categoryInfo("expense", "food").label, 100, 3),
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("needs a credit line", async () => {
    useDb({ ...seed(), accounts: [{ ...line, type: "loan" }] });
    expect(await addPurchasesToBill(LINE, all)).toEqual({
      error: "Couldn't find that credit line.",
    });
    expect(db.writes("installment_plans", "insert")).toEqual([]);
  });

  it("says so when a bill can't be saved", async () => {
    useDb(seed());
    db.respond((q) => (q.table === "installment_plans" && q.op === "insert" ? fail() : undefined));
    expect(await addPurchasesToBill(LINE, all)).toEqual({
      error: "Couldn't add it to the bill. Please try again.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("deleteLoanForGood", () => {
  const seed = () => ({
    accounts: [{ id: LOAN, type: "loan" }, ...wallets],
    installment_plans: [{ id: "plan-1", account_id: LOAN }],
    scheduled_payments: [
      { id: "sp-1", plan_id: "plan-1", transfer_txn_id: "pay-1", fee_txn_id: "fee-1" },
    ],
    transactions: [
      {
        id: "in",
        type: "transfer",
        account_id: LOAN,
        to_account_id: "bank",
        note: "SLoan received",
        occurred_on: "2026-01-10",
      },
      {
        id: "pay-1",
        type: "transfer",
        account_id: "bank",
        to_account_id: LOAN,
        note: "SLoan 1 of 12",
        occurred_on: "2026-02-15",
      },
      {
        id: "fee-1",
        type: "expense",
        category: "fees",
        account_id: "bank",
        note: "SLoan 1 of 12 · fee",
        occurred_on: "2026-02-15",
      },
      // From a plan removed earlier: found by its note, wallet and day.
      {
        id: "pay-0",
        type: "transfer",
        account_id: "cash",
        to_account_id: LOAN,
        note: "SLoan old 1 of 6",
        occurred_on: "2025-12-15",
      },
      {
        id: "fee-0",
        type: "expense",
        category: "fees",
        account_id: "cash",
        note: "SLoan old 1 of 6 · fee",
        occurred_on: "2025-12-15",
      },
      // Same note, other wallet: not this loan's.
      {
        id: "fee-x",
        type: "expense",
        category: "fees",
        account_id: "bank",
        note: "SLoan old 1 of 6 · fee",
        occurred_on: "2025-12-15",
      },
    ],
    planned_expenses: [{ id: "pl-1", account_id: LOAN }],
    recurring_items: [{ id: "r-1", account_id: LOAN }],
  });

  it("only takes a plain id", async () => {
    expect(await deleteLoanForGood(`${LOAN},id.neq.0`)).toEqual({
      error: "Couldn't find that loan.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("only deletes loans", async () => {
    useDb({ accounts: [{ id: LOAN, type: "bank" }] });
    expect(await deleteLoanForGood(LOAN)).toEqual({ error: "Couldn't find that loan." });
    expect(db.writeLog()).toEqual([]);
  });

  it("deletes the plan, every fee, the transfers and the loan", async () => {
    useDb(seed());
    expect(await deleteLoanForGood(LOAN)).toEqual({});
    expect(db.writeLog()).toEqual([
      "delete installment_plans",
      "delete transactions",
      "delete transactions",
      "update planned_expenses",
      "update recurring_items",
      "delete accounts",
    ]);
    const deletes = db.queries.filter((q) => q.table === "transactions" && q.op === "delete");
    expect(deletes[0].filters).toEqual([{ method: "in", args: ["id", ["fee-1", "fee-0"]] }]);
    // The fake ignores .or(), so check the filter it sends.
    expect(deletes[1].filters).toEqual([
      { method: "or", args: [`account_id.eq.${LOAN},to_account_id.eq.${LOAN}`] },
    ]);
    expect(db.table("planned_expenses")).toEqual([{ id: "pl-1", account_id: null }]);
    expect(db.table("recurring_items")).toEqual([{ id: "r-1", account_id: null }]);
    expect(db.table("accounts").map((a) => a.id)).toEqual(["cash", "bank", "usd"]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("stops before deleting history when the plan can't be removed", async () => {
    useDb(seed());
    db.respond((q) => (q.table === "installment_plans" && q.op === "delete" ? fail() : undefined));
    expect(await deleteLoanForGood(LOAN)).toEqual(FAILED);
    expect(db.writeLog()).toEqual(["delete installment_plans"]);
  });

  it("says so when only the loan itself couldn't be deleted", async () => {
    useDb(seed());
    db.respond((q) => (q.table === "accounts" && q.op === "delete" ? fail() : undefined));
    expect(await deleteLoanForGood(LOAN)).toEqual({
      error: "Its history is gone, but the loan itself couldn't be deleted. Please try again.",
    });
  });
});

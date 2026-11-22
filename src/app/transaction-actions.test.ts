import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  adjustBalance,
  deleteTransaction,
  saveBnplPurchase,
  saveTransaction,
  updateAdjustment,
  type TransactionInput,
} from "./transaction-actions";

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

const expense: TransactionInput = {
  type: "expense",
  amount: 120.456,
  accountId: "cash-1",
  toAccountId: null,
  category: "food",
  subcategory: "  Lunch ",
  note: "  jollibee   with  team ",
  occurredOn: "2026-11-19",
  occurredTime: "12:30",
};

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("saveTransaction", () => {
  it.each<[string, Partial<TransactionInput>, string]>([
    ["bad type", { type: "loan" as never }, "Pick Expense, Income or Transfer."],
    ["zero amount", { amount: 0 }, "Enter an amount above 0."],
    ["negative amount", { amount: -5 }, "Enter an amount above 0."],
    ["NaN amount", { amount: Number.NaN }, "Enter an amount above 0."],
    ["huge amount", { amount: 1e13 }, "That amount is too big."],
    ["no wallet", { accountId: "" }, "Pick a wallet."],
    ["no category", { category: null }, "Pick a category."],
    ["unknown category", { category: "yachts" }, "Pick a category."],
    ["bad date", { occurredOn: "2026-02-30" }, "Pick a date."],
    ["bad time", { occurredTime: "25:00" }, "Check the time."],
    ["long description", { note: "x".repeat(121) }, "Keep the description to 120 characters."],
    ["no description", { note: "   " }, "Add a description."],
    ["income with no category", { type: "income", category: null }, "Pick a category."],
    [
      "income with no description",
      { type: "income", category: "salary", note: "" },
      "Add a description.",
    ],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await saveTransaction({ ...expense, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a transfer with no destination or to the same wallet", async () => {
    const transfer = { ...expense, type: "transfer" as const, category: null };
    expect(await saveTransaction({ ...transfer, toAccountId: null })).toEqual({
      error: "Pick where the money goes.",
    });
    expect(await saveTransaction({ ...transfer, toAccountId: "cash-1" })).toEqual({
      error: "Pick two different wallets.",
    });
  });

  it("asks income for where the money went", async () => {
    expect(
      await saveTransaction({ ...expense, type: "income", category: null, accountId: "" }),
    ).toEqual({ error: "Pick where the money went." });
  });

  it("returns the signed-out error when there's no session", async () => {
    useDb({}, { user: null });
    expect(await saveTransaction(expense)).toEqual({ error: SIGNED_OUT_ERROR });
    expect(db.writeLog()).toEqual([]);
  });

  it("takes one of your own categories, but not a made-up one", async () => {
    useDb({
      user_categories: [{ id: "c1", type: "expense", key: "u_milk_tea", label: "Milk tea" }],
    });
    expect(await saveTransaction({ ...expense, category: "u_milk_tea" })).toEqual({});
    expect(db.table("transactions")[0]).toMatchObject({ category: "u_milk_tea" });
    expect(await saveTransaction({ ...expense, category: "u_vape" })).toEqual({
      error: "Pick a category.",
    });
    // Yours are for their own type only.
    expect(await saveTransaction({ ...expense, type: "income", category: "u_milk_tea" })).toEqual({
      error: "Pick a category.",
    });
  });

  it("inserts a cleaned-up row and refreshes", async () => {
    expect(await saveTransaction(expense)).toEqual({});
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "expense",
        amount: 120.46,
        account_id: "cash-1",
        to_account_id: null,
        category: "food",
        subcategory: "Lunch",
        note: "jollibee with team",
        occurred_on: "2026-11-19",
        occurred_time: "12:30",
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("updates the given id instead of inserting", async () => {
    useDb({ transactions: [{ id: "t1", type: "expense", amount: 1 }] });
    expect(await saveTransaction(expense, "t1")).toEqual({});
    expect(db.writeLog()).toEqual(["update transactions"]);
    expect(db.table("transactions")[0]).toMatchObject({ id: "t1", amount: 120.46 });
  });

  it("fails when the update matched no row (someone else's id)", async () => {
    expect(await saveTransaction(expense, "not-mine")).toEqual({
      error: "Couldn't save that. Please try again.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("retries without occurred_time before migration 0014", async () => {
    let first = true;
    db.respond((q) => {
      if (q.table === "transactions" && q.op === "insert" && first) {
        first = false;
        return fail("PGRST204", "Could not find the 'occurred_time' column");
      }
    });
    expect(await saveTransaction(expense)).toEqual({});
    const [, retry] = db.writes("transactions", "insert") as Record<string, unknown>[];
    expect(retry).not.toHaveProperty("occurred_time");
    expect(retry).toHaveProperty("subcategory", "Lunch");
  });

  it("won't drop a typed subcategory before migration 0015", async () => {
    db.respond((q) =>
      q.table === "transactions" ? fail("PGRST204", "column 'subcategory'") : undefined,
    );
    const result = await saveTransaction(expense);
    expect(result.error).toMatch(/run step 15/);
  });

  it("explains the dollar-wallet check", async () => {
    db.respond((q) =>
      q.table === "transactions" ? fail("23514", "Dollar wallets only ...") : undefined,
    );
    expect((await saveTransaction(expense)).error).toMatch(/Dollar wallets only move money/);
  });

  it("links a logged occurrence to its bill", async () => {
    expect(await saveTransaction(expense, undefined, "bill-9|2026-11-15")).toEqual({});
    const [txn] = db.table("transactions");
    expect(db.writes("bill_payments", "insert")).toEqual([
      { recurring_item_id: "bill-9", due_on: "2026-11-15", transaction_id: txn.id },
    ]);
  });

  it("undoes the transaction when the bill was already logged", async () => {
    db.respond((q) =>
      q.table === "bill_payments" && q.op === "insert" ? fail("23505", "duplicate") : undefined,
    );
    expect(await saveTransaction(expense, undefined, "bill-9|2026-11-15")).toEqual({
      error: "That's already logged.",
    });
    expect(db.writeLog()).toEqual([
      "insert transactions",
      "insert bill_payments",
      "delete transactions",
    ]);
    expect(db.table("transactions")).toEqual([]);
  });

  it("averages a dollar wallet's rate after buying dollars", async () => {
    useDb({
      accounts: [{ id: "usd", currency: "USD", fx_rate: 50 }],
      // 100 dollars held before + 100 just bought.
      account_balances: [{ account_id: "usd", balance: 200 }],
    });
    const buy: TransactionInput = {
      ...expense,
      type: "transfer",
      category: null,
      toAccountId: "usd",
      amount: 6000,
      toAmount: 100,
    };
    expect(await saveTransaction(buy)).toEqual({});
    // (100 × 50 + 6000) / 200 = 55
    expect(db.writes("accounts", "update")).toEqual([{ fx_rate: 55 }]);
  });
});

describe("saveBnplPurchase", () => {
  const plan = { months: 3, ratePerMonth: 0, firstDue: "2026-12-05", payFromAccountId: "bank-1" };
  const accounts = [
    { id: "spl", type: "credit_line" },
    { id: "bank-1", type: "bank" },
    { id: "cash-1", type: "cash" },
  ];

  it.each<[string, Partial<typeof plan>, string]>([
    ["0 months", { months: 0 }, "Pick how many months."],
    ["25 months", { months: 25 }, "Pick how many months."],
    ["fee above 10%", { ratePerMonth: 11 }, "Check the monthly fee (0 to 10%)."],
    [
      "first due before purchase",
      { firstDue: "2026-11-01" },
      "The first payment can't be before the purchase.",
    ],
  ])("rejects %s", async (_, patch, error) => {
    expect(await saveBnplPurchase({ ...expense, accountId: "spl" }, { ...plan, ...patch })).toEqual(
      {
        error,
      },
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("only takes expenses", async () => {
    expect(
      await saveBnplPurchase({ ...expense, type: "income", category: "salary" }, plan),
    ).toMatchObject({ error: expect.any(String) });
  });

  it("needs a credit line to pay with", async () => {
    useDb({ accounts });
    expect(await saveBnplPurchase(expense, plan)).toEqual({
      error: "Pick a BNPL credit line to pay with.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("saves the expense, the plan and one payment a month", async () => {
    useDb({ accounts });
    expect(await saveBnplPurchase({ ...expense, accountId: "spl", amount: 300 }, plan)).toEqual({});
    const [txn] = db.table("transactions");
    expect(db.writes("installment_plans", "insert")).toEqual([
      expect.objectContaining({
        kind: "bnpl",
        account_id: "spl",
        principal: 300,
        months: 3,
        first_due: "2026-12-05",
        pay_from_account_id: "bank-1",
        source_txn_id: txn.id,
      }),
    ]);
    const [payments] = db.writes("scheduled_payments", "insert") as Record<string, unknown>[][];
    expect(payments.map((p) => p.amount)).toEqual([100, 100, 100]);
  });

  it("removes the expense when the plan can't be saved", async () => {
    useDb({ accounts });
    db.respond((q) => (q.table === "installment_plans" ? fail() : undefined));
    expect(await saveBnplPurchase({ ...expense, accountId: "spl" }, plan)).toEqual({
      error: "Couldn't save the payment plan. Please try again.",
    });
    expect(db.table("transactions")).toEqual([]);
  });
});

describe("adjustBalance", () => {
  const input = { occurredOn: "2026-11-19", note: "" };

  it("rejects a non-number", async () => {
    expect(await adjustBalance("cash-1", Number.NaN, input)).toEqual({
      error: "Check the amount.",
    });
  });

  it("only adjusts wallets you spend from", async () => {
    useDb({
      accounts: [{ id: "spl", type: "credit_line", archived: false }],
      account_balances: [{ account_id: "spl", balance: 0 }],
    });
    expect((await adjustBalance("spl", 10, input)).error).toMatch(/Only cash, bank/);
  });

  it("logs the difference as income or expense", async () => {
    useDb({
      accounts: [{ id: "cash-1", type: "cash", archived: false }],
      account_balances: [{ account_id: "cash-1", balance: 500 }],
    });
    expect(await adjustBalance("cash-1", 450, input)).toEqual({});
    expect(await adjustBalance("cash-1", 520.5, input)).toEqual({});
    expect(db.writes("transactions", "insert")).toEqual([
      expect.objectContaining({ type: "expense", amount: 50, account_id: "cash-1" }),
      expect.objectContaining({ type: "income", amount: 20.5, account_id: "cash-1" }),
    ]);
  });

  it("says so when nothing changed", async () => {
    useDb({
      accounts: [{ id: "cash-1", type: "cash", archived: false }],
      account_balances: [{ account_id: "cash-1", balance: 500 }],
    });
    expect(await adjustBalance("cash-1", 500, input)).toEqual({
      error: "That's already what's in it.",
    });
  });
});

describe("updateAdjustment", () => {
  it("rejects a zero change", async () => {
    expect(await updateAdjustment("t1", 0, { occurredOn: "2026-11-19", note: "" })).toEqual({
      error: "Enter an amount above ₱0.",
    });
  });

  it("only updates adjustments, never transfers", async () => {
    await updateAdjustment("t1", -20, { occurredOn: "2026-11-19", note: "" });
    const update = db.queries.find((q) => q.op === "update")!;
    expect(update.filters.map((f) => [f.method, ...f.args])).toEqual([
      ["eq", "id", "t1"],
      ["eq", "category", expect.any(String)],
      ["neq", "type", "transfer"],
    ]);
  });
});

describe("deleteTransaction", () => {
  it("deletes by id", async () => {
    useDb({ transactions: [{ id: "t1" }, { id: "t2" }] });
    expect(await deleteTransaction("t1")).toEqual({});
    expect(db.table("transactions")).toEqual([{ id: "t2" }]);
  });

  it("fails when nothing was deleted", async () => {
    expect(await deleteTransaction("gone")).toEqual({
      error: "Couldn't delete that. Please try again.",
    });
  });
});

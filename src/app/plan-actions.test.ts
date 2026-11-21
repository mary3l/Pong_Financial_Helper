import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  addPlannedExpense,
  logPlanned,
  logRecurring,
  removeBudget,
  saveBudget,
  undoPayday,
  type PlannedInput,
} from "./plan-actions";

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

const wallets = [
  { id: "cash", type: "cash", archived: false, currency: "PHP", created_at: "1" },
  { id: "bank", type: "bank", archived: false, currency: "PHP", created_at: "2" },
  { id: "usd", type: "bank", archived: false, currency: "USD", created_at: "3" },
  { id: "spl", type: "credit_line", archived: false, currency: "PHP", created_at: "4" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
  useDb();
});
afterEach(() => vi.useRealTimers());

describe("logRecurring", () => {
  const bill = {
    id: "b1",
    kind: "bill",
    name: "Meralco",
    amount: 2400,
    account_id: "bank",
    category: null,
  };

  it("rejects a bad date or amount before signing in", async () => {
    expect(await logRecurring("b1", "nope")).toEqual({ error: expect.any(String) });
    expect(await logRecurring("b1", "2026-11-15", undefined, -1)).toEqual({
      error: "Enter an amount.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await logRecurring("b1", "2026-11-15")).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("logs a bill as an expense today and links it to the due date", async () => {
    useDb({ recurring_items: [bill], accounts: wallets });
    expect(await logRecurring("b1", "2026-11-15")).toEqual({});
    const [txn] = db.table("transactions");
    expect(txn).toMatchObject({
      type: "expense",
      amount: 2400,
      account_id: "bank",
      category: "bills",
      note: "Meralco",
      occurred_on: "2026-11-19",
    });
    expect(db.writes("bill_payments")).toEqual([
      { recurring_item_id: "b1", due_on: "2026-11-15", transaction_id: txn.id },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("logs a payday as income with the amount that came in", async () => {
    useDb({
      recurring_items: [{ ...bill, kind: "payday", amount: null, account_id: null }],
      accounts: wallets,
    });
    expect(await logRecurring("b1", "2026-11-15", undefined, 18000.004)).toEqual({});
    expect(db.table("transactions")[0]).toMatchObject({
      type: "income",
      amount: 18000,
      account_id: "cash",
      category: "salary",
      note: "Payday",
    });
  });

  it("won't log with no amount saved or given", async () => {
    useDb({ recurring_items: [{ ...bill, amount: null }], accounts: wallets });
    expect(await logRecurring("b1", "2026-11-15")).toEqual({
      error: "Set an amount for it first.",
    });
  });

  it("won't log to a dollar wallet or credit line", async () => {
    useDb({ recurring_items: [bill], accounts: wallets });
    expect(await logRecurring("b1", "2026-11-15", "usd")).toEqual({
      error: "Pick a cash, bank or e-wallet.",
    });
    expect(await logRecurring("b1", "2026-11-15", "spl")).toEqual({
      error: "Pick a cash, bank or e-wallet.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("removes the duplicate when it was already logged", async () => {
    useDb({ recurring_items: [bill], accounts: wallets });
    db.respond((q) => (q.table === "bill_payments" ? fail("23505", "duplicate") : undefined));
    expect(await logRecurring("b1", "2026-11-15")).toEqual({});
    expect(db.table("transactions")).toEqual([]);
  });
});

describe("logPlanned", () => {
  const planned = {
    id: "p1",
    type: "expense",
    name: "New phone",
    amount: 9999,
    category: "shopping",
    account_id: null,
    transaction_id: null,
  };

  it("logs it and links the transaction", async () => {
    useDb({ planned_expenses: [planned], accounts: wallets });
    expect(await logPlanned("p1")).toEqual({});
    const [txn] = db.table("transactions");
    expect(txn).toMatchObject({ type: "expense", amount: 9999, account_id: "cash" });
    expect(db.table("planned_expenses")[0].transaction_id).toBe(txn.id);
  });

  it("does nothing when it's already logged", async () => {
    useDb({ planned_expenses: [{ ...planned, transaction_id: "t0" }], accounts: wallets });
    expect(await logPlanned("p1")).toEqual({});
    expect(db.writeLog()).toEqual([]);
  });

  it("needs a wallet", async () => {
    useDb({ planned_expenses: [planned] });
    expect((await logPlanned("p1")).error).toMatch(/Add a wallet first/);
  });
});

describe("addPlannedExpense", () => {
  const input: PlannedInput = {
    name: " Laptop ",
    amount: 30000,
    category: "shopping",
    first: "2026-12-01",
    months: 3,
  };

  it.each<[string, Partial<PlannedInput>, string]>([
    ["long name", { name: "x".repeat(51) }, "Keep the name to 50 characters."],
    ["zero amount", { amount: 0 }, "Enter an amount above ₱0."],
    ["income category", { category: "salary" }, "Pick a category."],
    ["past date", { first: "2026-11-18" }, "Pick today or a later date."],
    ["25 months", { months: 25 }, "Pick how many months."],
    ["half a month", { months: 1.5 }, "Pick how many months."],
  ])("rejects %s", async (_, patch, error) => {
    expect(await addPlannedExpense({ ...input, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("splits it into monthly rows", async () => {
    expect(await addPlannedExpense(input)).toEqual({});
    expect(db.writes("planned_expenses", "insert")).toEqual([
      [
        {
          name: "Laptop (1 of 3)",
          amount: 10000,
          category: "shopping",
          due_on: "2026-12-01",
          account_id: null,
        },
        {
          name: "Laptop (2 of 3)",
          amount: 10000,
          category: "shopping",
          due_on: "2027-01-01",
          account_id: null,
        },
        {
          name: "Laptop (3 of 3)",
          amount: 10000,
          category: "shopping",
          due_on: "2027-02-01",
          account_id: null,
        },
      ],
    ]);
  });

  it("only takes one of your peso wallets", async () => {
    useDb({ accounts: wallets });
    expect(await addPlannedExpense({ ...input, accountId: "usd" })).toEqual({
      error: "Pick one of your wallets.",
    });
  });
});

describe("budgets", () => {
  it("rejects an unknown category or zero", async () => {
    expect(await saveBudget("yachts", 100)).toEqual({ error: "Pick a category." });
    expect(await saveBudget("food", 0)).toEqual({ error: "Enter an amount above ₱0." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("upserts per category", async () => {
    expect(await saveBudget("food", 2500.999)).toEqual({});
    const upsert = db.queries.find((q) => q.op === "upsert")!;
    expect(upsert.payload).toEqual({ category: "food", amount: 2501 });
    expect(upsert.options).toEqual({ onConflict: "user_id,category" });
  });

  it("removes one, and says so when it's gone already", async () => {
    useDb({ budgets: [{ id: "bg1" }] });
    expect(await removeBudget("bg1")).toEqual({});
    expect(await removeBudget("bg1")).toEqual({
      error: "Couldn't remove that budget. Please try again.",
    });
  });
});

describe("a payday with a salary loan", () => {
  // GSIS MPL: ₱2,000 a month, ₱1,800 of it principal, taken from the month's last payday.
  const seed = () => ({
    accounts: [...wallets, { id: "mpl", type: "loan", archived: false, currency: "PHP" }],
    recurring_items: [
      {
        id: "pay",
        kind: "payday",
        name: "Payday",
        amount: 13000,
        account_id: "bank",
        category: null,
      },
    ],
    installment_plans: [
      {
        id: "plan-mpl",
        account_id: "mpl",
        name: "GSIS MPL",
        months: 24,
        pay_from_account_id: null,
        pay_by: "salary",
      },
    ],
    scheduled_payments: [
      {
        id: "sp-3",
        plan_id: "plan-mpl",
        seq: 3,
        amount: 2000,
        principal_part: 1800,
        fee_part: 200,
        transfer_txn_id: null,
        fee_txn_id: null,
      },
    ],
  });

  it("logs what landed plus the loan, then pays the loan from it", async () => {
    useDb(seed());
    expect(await logRecurring("pay", "2026-11-30", "bank", 11000, ["sp-3"])).toEqual({});
    const txns = db.table("transactions");
    // ₱11,000 landed; ₱2,000 went to the loan before it did.
    expect(txns.find((t) => t.type === "income")).toMatchObject({
      amount: 13000,
      account_id: "bank",
    });
    expect(txns.find((t) => t.type === "transfer")).toMatchObject({
      amount: 1800,
      account_id: "bank",
      to_account_id: "mpl",
      note: "GSIS MPL 3 of 24 · from pay",
    });
    expect(txns.find((t) => t.type === "expense")).toMatchObject({
      amount: 200,
      account_id: "bank",
    });
    // The wallet moves by exactly what landed.
    const change = txns.reduce(
      (sum, t) => sum + (t.type === "income" ? Number(t.amount) : -Number(t.amount)),
      0,
    );
    expect(change).toBe(11000);
    expect(db.table("scheduled_payments")[0].transfer_txn_id).not.toBeNull();
  });

  it("ignores payments that aren't salary loans or are already paid", async () => {
    const s = seed();
    s.installment_plans[0] = { ...s.installment_plans[0], pay_by: "wallet" };
    useDb(s);
    expect(await logRecurring("pay", "2026-11-30", "bank", 11000, ["sp-3"])).toEqual({});
    expect(db.table("transactions")).toEqual([
      expect.objectContaining({ type: "income", amount: 11000 }),
    ]);
  });

  it("undoing the payday un-pays the loan too", async () => {
    useDb(seed());
    await logRecurring("pay", "2026-11-30", "bank", 11000, ["sp-3"]);
    const income = db.table("transactions").find((t) => t.type === "income")!;
    expect(await undoPayday(income.id as string)).toEqual({});
    // The payday, and the loan's transfer and fee: deleting those un-pays the
    // payment (on delete set null, migration 0005; the fake has no foreign keys).
    expect(db.table("transactions")).toEqual([]);
  });
});

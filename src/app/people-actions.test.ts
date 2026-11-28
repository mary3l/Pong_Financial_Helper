import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { formatPeso } from "@/lib/money";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  addLoanForPerson,
  addSplitsToBill,
  assignPlanToPerson,
  borrowWasPaidForMe,
  deletePerson,
  deletePersonEntry,
  deleteSplit,
  forgive,
  lendFromCreditLine,
  lendOrBorrow,
  recordPayment,
  renamePerson,
  restorePerson,
  saveSplit,
  settlePerson,
  theyPaidInstallments,
  updateSplit,
  type CreditLendInput,
  type LendInput,
  type PersonLoanInput,
  type SplitInput,
} from "./people-actions";

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

type Row = Record<string, unknown>;

/** Ids that pass the actions' uuid checks. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CASH = uuid(1);
const BANK = uuid(2);
const USD = uuid(3);
const ATOME = uuid(4);
const ANA = uuid(10);
const BEN = uuid(11);
const SPLIT = uuid(20);
const E1 = uuid(30);
const T1 = uuid(31);
const T2 = uuid(32);
const SRC = uuid(40);

const FAILED = { error: "Couldn't save that. Please try again." };

const wallets = [
  { id: CASH, type: "cash", name: "Cash", archived: false, currency: "PHP", created_at: "1" },
  { id: BANK, type: "bank", name: "BPI", archived: false, currency: "PHP", created_at: "2" },
  { id: USD, type: "bank", name: "GoTyme USD", archived: false, currency: "USD", created_at: "3" },
  {
    id: ATOME,
    type: "credit_line",
    name: "Atome",
    archived: false,
    currency: "PHP",
    created_at: "4",
    due_day: 5,
    cutoff_day: null,
    starting_balance: 2500,
  },
];
const ana = { id: ANA, type: "person", name: "Ana", archived: false };
const ben = { id: BEN, type: "person", name: "Ben", archived: false };
const accounts = [...wallets, ana, ben];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
  useDb();
});
afterEach(() => vi.useRealTimers());

// ── lendOrBorrow ────────────────────────────────────────────────────────

describe("lendOrBorrow", () => {
  const lend: LendInput = {
    direction: "lend",
    who: { personId: ANA },
    amount: 500.004,
    walletId: CASH,
    occurredOn: "2026-11-19",
    dueOn: "2026-12-15",
    countInForecast: true,
    note: "  for   rent ",
  };

  it.each<[string, Partial<LendInput>, string]>([
    ["zero amount", { amount: 0 }, "Enter an amount above ₱0."],
    ["NaN amount", { amount: Number.NaN }, "Enter an amount above ₱0."],
    ["huge amount", { amount: 1e13 }, "Enter an amount above ₱0."],
    ["bad date", { occurredOn: "2026-02-30" }, "Pick a date."],
    ["bad due date", { dueOn: "soon" }, "Check the due date, or leave it blank."],
    ["blank name", { who: { name: "   " } }, "Who is it?"],
    [
      "paid-for-me with an unknown category",
      { direction: "borrow", paidForMe: { category: "yachts" } },
      "Pick what it was for.",
    ],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await lendOrBorrow({ ...lend, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the signed-out error when there's no session", async () => {
    useDb({ accounts }, { user: null });
    expect(await lendOrBorrow(lend)).toEqual({ error: SIGNED_OUT_ERROR });
    expect(db.writeLog()).toEqual([]);
  });

  it("lends: a transfer from the wallet to them, with a forecast-counted entry", async () => {
    useDb({ accounts });
    expect(await lendOrBorrow(lend)).toEqual({ personId: ANA });
    const [txn] = db.table("transactions");
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 500,
        account_id: CASH,
        to_account_id: ANA,
        note: "for rent",
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      {
        transaction_id: txn.id,
        person_id: ANA,
        kind: "lend",
        due_on: "2026-12-15",
        count_in_forecast: true,
        split_total: null,
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("borrows from someone new: adds them, then a transfer from them to the wallet", async () => {
    useDb({ accounts });
    const result = await lendOrBorrow({
      ...lend,
      direction: "borrow",
      who: { name: "  Carlo   Reyes " },
      walletId: BANK,
      dueOn: null,
      note: "",
    });
    expect(db.writes("accounts", "insert")).toEqual([
      { name: "Carlo Reyes", type: "person", starting_balance: 0 },
    ]);
    const carlo = db.table("accounts").find((a) => a.name === "Carlo Reyes")!;
    expect(result).toEqual({ personId: carlo.id });
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 500,
        account_id: carlo.id,
        to_account_id: BANK,
        note: "Utang",
        occurred_on: "2026-11-19",
      },
    ]);
    // Borrowing never counts in the forecast, and no due date means it can't.
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ kind: "borrow", due_on: null, count_in_forecast: false }),
    ]);
  });

  it("brings back an archived person with the same name instead of adding them twice", async () => {
    useDb({ accounts: [...wallets, { ...ana, archived: true }] });
    expect(await lendOrBorrow({ ...lend, who: { name: "ana" } })).toEqual({ personId: ANA });
    expect(db.writes("accounts", "insert")).toEqual([]);
    expect(db.writes("accounts", "update")).toEqual([{ archived: false }]);
  });

  it("borrows when they paid for something of yours: an expense from their account", async () => {
    useDb({ accounts });
    expect(
      await lendOrBorrow({
        ...lend,
        direction: "borrow",
        walletId: "",
        note: "",
        paidForMe: { category: "transport" },
      }),
    ).toEqual({ personId: ANA });
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "expense",
        amount: 500,
        account_id: ANA,
        category: "transport",
        note: "Utang",
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ kind: "borrow", count_in_forecast: false }),
    ]);
  });

  it("needs a wallet you spend from", async () => {
    useDb({ accounts });
    expect(await lendOrBorrow({ ...lend, walletId: ATOME })).toEqual({ error: "Pick a wallet." });
    expect(db.writeLog()).toEqual([]);
  });

  it("rejects a person id that isn't a person", async () => {
    useDb({ accounts });
    expect(await lendOrBorrow({ ...lend, who: { personId: BANK } })).toEqual({
      error: "Check the name (up to 60 characters).",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("removes the transaction when its person entry can't be saved", async () => {
    useDb({ accounts });
    db.respond((q) => (q.table === "person_entries" && q.op === "insert" ? fail() : undefined));
    expect(await lendOrBorrow(lend)).toEqual(FAILED);
    expect(db.writeLog()).toEqual([
      "insert transactions",
      "insert person_entries",
      "delete transactions",
    ]);
    expect(db.table("transactions")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ── borrowWasPaidForMe ──────────────────────────────────────────────────

describe("borrowWasPaidForMe", () => {
  const seed = () => ({
    accounts,
    transactions: [{ id: T1, type: "transfer", amount: 800, account_id: ANA, to_account_id: CASH }],
    person_entries: [{ transaction_id: T1, person_id: ANA, kind: "borrow" }],
  });

  it("rejects bad ids and categories before signing in", async () => {
    expect(await borrowWasPaidForMe("ana", T1, "transport")).toEqual({
      error: "Couldn't find that.",
    });
    expect(await borrowWasPaidForMe(ANA, T1, "yachts")).toEqual({
      error: "Pick what it was for.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("turns the borrow transfer into an expense from their account", async () => {
    useDb(seed());
    expect(await borrowWasPaidForMe(ANA, T1, "transport")).toEqual({ personId: ANA });
    expect(db.writes("transactions", "update")).toEqual([
      { type: "expense", to_account_id: null, category: "transport" },
    ]);
    const update = db.queries.find((q) => q.op === "update")!;
    expect(update.filters.map((f) => [f.method, ...f.args])).toEqual([
      ["eq", "id", T1],
      ["eq", "type", "transfer"],
      ["eq", "account_id", ANA],
    ]);
  });

  it("only changes money you borrowed", async () => {
    const s = seed();
    s.person_entries[0].kind = "lend";
    useDb(s);
    expect(await borrowWasPaidForMe(ANA, T1, "transport")).toEqual({
      error: "Only money you borrowed can be changed this way.",
    });
    expect(db.writeLog()).toEqual([]);
  });
});

// ── recordPayment ───────────────────────────────────────────────────────

describe("recordPayment", () => {
  it.each<[string, number, string, string]>([
    ["zero", 0, "2026-11-19", "Enter an amount above ₱0."],
    ["negative", -10, "2026-11-19", "Enter an amount above ₱0."],
    ["bad date", 100, "2026-13-01", "Pick a date."],
  ])("rejects %s before signing in", async (_, amount, date, error) => {
    expect(await recordPayment(ANA, amount, CASH, date)).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the signed-out error when there's no session", async () => {
    useDb({}, { user: null });
    expect(await recordPayment(ANA, 100, CASH)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("they pay you back: a transfer from them into the wallet, today by default", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 500 }] });
    expect(await recordPayment(ANA, 200.005, CASH)).toEqual({ personId: ANA });
    const [txn] = db.table("transactions");
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 200.01,
        account_id: ANA,
        to_account_id: CASH,
        note: "Paid me back",
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      {
        transaction_id: txn.id,
        person_id: ANA,
        kind: "payment",
        due_on: null,
        count_in_forecast: false,
        split_total: null,
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("you pay them back: a transfer from the wallet to them", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: -300 }] });
    expect(await recordPayment(ANA, 300, BANK, "2026-11-01")).toEqual({ personId: ANA });
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 300,
        account_id: BANK,
        to_account_id: ANA,
        note: "Paid back",
        occurred_on: "2026-11-01",
      },
    ]);
  });

  it("won't take more than the balance", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: -300 }] });
    expect(await recordPayment(ANA, 300.01, CASH)).toEqual({
      error: "That's more than the balance.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("says when you're all square (zero or no balance)", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 0 }] });
    expect(await recordPayment(ANA, 1, CASH)).toEqual({ error: "You're all square with them." });
    expect(await recordPayment(BEN, 1, CASH)).toEqual({ error: "You're all square with them." });
    expect(db.writeLog()).toEqual([]);
  });

  it("only pays into or out of a cash, bank or e-wallet", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 500 }] });
    expect(await recordPayment(ANA, 100, ATOME)).toEqual({ error: "Pick a wallet." });
    expect(await recordPayment(ANA, 100, "missing")).toEqual({ error: "Pick a wallet." });
    expect(db.writeLog()).toEqual([]);
  });

  it("removes the payment when its person entry can't be saved", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 500 }] });
    db.respond((q) => (q.table === "person_entries" && q.op === "insert" ? fail() : undefined));
    expect(await recordPayment(ANA, 100, CASH)).toEqual(FAILED);
    expect(db.table("transactions")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ── settlePerson ────────────────────────────────────────────────────────

describe("settlePerson", () => {
  it("returns the signed-out error when there's no session", async () => {
    useDb({}, { user: null });
    expect(await settlePerson(ANA)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("settles what you owe them from your first peso wallet", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: -250.5 }] });
    expect(await settlePerson(ANA)).toEqual({ personId: ANA });
    expect(db.writes("transactions", "insert")).toEqual([
      expect.objectContaining({
        type: "transfer",
        amount: 250.5,
        account_id: CASH,
        to_account_id: ANA,
        note: "Paid back",
      }),
    ]);
  });

  it("settles what they owe you into the wallet picked", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 900 }] });
    expect(await settlePerson(ANA, BANK)).toEqual({ personId: ANA });
    expect(db.writes("transactions", "insert")).toEqual([
      expect.objectContaining({ amount: 900, account_id: ANA, to_account_id: BANK }),
    ]);
  });

  it("won't settle with a dollar wallet or a credit line", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 900 }] });
    expect(await settlePerson(ANA, USD)).toEqual({ error: "Pick a cash, bank or e-wallet." });
    expect(await settlePerson(ANA, ATOME)).toEqual({ error: "Pick a cash, bank or e-wallet." });
    expect(db.writeLog()).toEqual([]);
  });

  it("needs a wallet first", async () => {
    useDb({ accounts: [ana], account_balances: [{ account_id: ANA, balance: 900 }] });
    expect(await settlePerson(ANA)).toEqual({ error: "Add a wallet first." });
  });

  it("does nothing when you're already square", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 0 }] });
    expect(await settlePerson(ANA)).toEqual({});
    expect(db.writeLog()).toEqual([]);
  });
});

// ── forgive ─────────────────────────────────────────────────────────────

describe("forgive", () => {
  it("forgiving pautang is an expense (Gifts) from their account, today", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 500 }] });
    expect(await forgive(ANA)).toEqual({ personId: ANA });
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "expense",
        amount: 500,
        account_id: ANA,
        category: "gifts",
        note: "Forgiven",
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ person_id: ANA, kind: "forgive" }),
    ]);
  });

  it("utang they forgive is income (Gift)", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: -120 }] });
    expect(await forgive(ANA)).toEqual({ personId: ANA });
    expect(db.writes("transactions", "insert")).toEqual([
      expect.objectContaining({ type: "income", amount: 120, category: "gift" }),
    ]);
  });

  it("has nothing to forgive at zero", async () => {
    useDb({ accounts, account_balances: [{ account_id: ANA, balance: 0 }] });
    expect(await forgive(ANA)).toEqual({ error: "There's nothing left to forgive." });
    expect(db.writeLog()).toEqual([]);
  });
});

// ── saveSplit ───────────────────────────────────────────────────────────

describe("saveSplit", () => {
  const split: SplitInput = {
    total: 900,
    category: "food",
    subcategory: null,
    note: " Dinner ",
    occurredOn: "2026-11-19",
    paidBy: null,
    walletId: CASH,
    myShare: 300,
    others: [{ who: { personId: ANA }, amount: 600 }],
  };

  it.each<[string, Partial<SplitInput>, string]>([
    ["zero total", { total: 0 }, "Enter an amount above ₱0."],
    ["unknown category", { category: "yachts" }, "Pick a category."],
    ["bad date", { occurredOn: "nope" }, "Pick a date."],
    ["no one to split with", { others: [] }, "Pick who you split it with."],
    ["a negative share of yours", { myShare: -1 }, "Check the shares."],
    [
      "a share that isn't a number",
      { others: [{ who: { personId: ANA }, amount: Number.NaN }] },
      "Check the shares.",
    ],
    ["shares that don't add up", { myShare: 200 }, "The shares add up to ₱800, not ₱900."],
    [
      "a long subcategory",
      { subcategory: "x".repeat(41) },
      "Keep the subcategory to 40 characters.",
    ],
  ])("rejects %s before signing in", async (_, patch, error) => {
    expect(await saveSplit({ ...split, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the signed-out error when there's no session", async () => {
    useDb({ accounts }, { user: null });
    expect(await saveSplit(split)).toEqual({ error: SIGNED_OUT_ERROR });
    expect(db.writeLog()).toEqual([]);
  });

  it("you paid: your share is an expense and theirs is pautang, all with one split id", async () => {
    useDb({ accounts });
    expect(await saveSplit({ ...split, subcategory: "  Pizza " })).toEqual({});
    const [mine, theirs] = db.writes("transactions", "insert") as Row[];
    expect(mine).toEqual({
      type: "expense",
      amount: 300,
      account_id: CASH,
      category: "food",
      subcategory: "Pizza",
      note: "Dinner (my share)",
      occurred_on: "2026-11-19",
      split_id: expect.any(String),
    });
    expect(theirs).toEqual({
      type: "transfer",
      amount: 600,
      account_id: CASH,
      to_account_id: ANA,
      note: "Split: Dinner",
      occurred_on: "2026-11-19",
      split_id: mine.split_id,
    });
    const transfer = db.table("transactions")[1];
    expect(db.writes("person_entries", "insert")).toEqual([
      {
        transaction_id: transfer.id,
        person_id: ANA,
        kind: "split",
        due_on: null,
        count_in_forecast: false,
        split_total: 900,
      },
    ]);
    // A cash wallet: no payment plan.
    expect(db.writes("installment_plans")).toEqual([]);
    // The form refreshes once it has closed (refreshApp).
    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips ₱0 shares and leaves out split_id before migration 0012", async () => {
    useDb({ accounts });
    db.respond((q) =>
      q.table === "transactions" && q.op === "select" && q.columns === "split_id"
        ? fail("42703", "column split_id does not exist")
        : undefined,
    );
    expect(
      await saveSplit({
        ...split,
        note: "",
        myShare: 0,
        others: [
          { who: { personId: ANA }, amount: 900 },
          { who: { personId: BEN }, amount: 0 },
        ],
      }),
    ).toEqual({});
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 900,
        account_id: CASH,
        to_account_id: ANA,
        note: "Split bill",
        occurred_on: "2026-11-19",
      },
    ]);
  });

  it("asks for step 15 before saving a subcategory", async () => {
    useDb({ accounts });
    db.respond((q) =>
      q.table === "transactions" && q.columns === "subcategory"
        ? fail("42703", "column subcategory does not exist")
        : undefined,
    );
    expect((await saveSplit({ ...split, subcategory: "Pizza" })).error).toMatch(/run step 15/);
    expect(db.writeLog()).toEqual([]);
  });

  it("needs the wallet you paid with", async () => {
    useDb({ accounts });
    expect(await saveSplit({ ...split, walletId: null })).toEqual({
      error: "Pick the wallet you paid with.",
    });
    expect(await saveSplit({ ...split, walletId: ANA })).toEqual({
      error: "Pick the wallet you paid with.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("undoes every record when someone's share can't be saved", async () => {
    useDb({ accounts });
    expect(
      await saveSplit({
        ...split,
        others: [
          { who: { personId: ANA }, amount: 300 },
          { who: { personId: "not-a-person" }, amount: 300 },
        ],
      }),
    ).toEqual(FAILED);
    expect(db.table("transactions")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("paid with a credit line: the whole bill goes on its next bill by default", async () => {
    useDb({ accounts });
    expect(await saveSplit({ ...split, walletId: ATOME })).toEqual({});
    const [mine] = db.table("transactions");
    expect(db.writes("installment_plans", "insert")).toEqual([
      {
        kind: "bnpl",
        account_id: ATOME,
        name: "Dinner",
        principal: 900,
        fee_total: 0,
        months: 1,
        // Due day 5, bought Nov 19: the Dec 5 bill.
        first_due: "2026-12-05",
        pay_from_account_id: null,
        source_txn_id: mine.id,
      },
    ]);
    const [payments] = db.writes("scheduled_payments", "insert") as Row[][];
    expect(payments).toEqual([
      expect.objectContaining({ seq: 1, due_on: "2026-12-05", amount: 900, fee_part: 0 }),
    ]);
  });

  it("paid with a credit line in installments: fee and payments follow the plan", async () => {
    useDb({ accounts });
    const plan = { months: 3, ratePerMonth: 1, firstDue: "2026-12-05", payFromAccountId: BANK };
    expect(await saveSplit({ ...split, walletId: ATOME, plan })).toEqual({});
    expect(db.writes("installment_plans", "insert")).toEqual([
      expect.objectContaining({
        principal: 900,
        // 900 × 1% × 3 months.
        fee_total: 27,
        months: 3,
        pay_from_account_id: BANK,
      }),
    ]);
    const [payments] = db.writes("scheduled_payments", "insert") as Row[][];
    expect(payments.map((p) => [p.due_on, p.principal_part, p.fee_part, p.amount])).toEqual([
      ["2026-12-05", 300, 9, 309],
      ["2027-01-05", 300, 9, 309],
      ["2027-02-05", 300, 9, 309],
    ]);
  });

  it.each<[string, object, string]>([
    ["0 months", { months: 0 }, "Pick how many months."],
    ["fee above 10%", { ratePerMonth: 11 }, "Check the monthly fee (0 to 10%)."],
    [
      "first due before the bill",
      { firstDue: "2026-11-01" },
      "The first payment can't be before the bill.",
    ],
  ])("rejects a credit line plan with %s", async (_, patch, error) => {
    useDb({ accounts });
    const plan = { months: 1, ratePerMonth: 0, firstDue: "2026-12-05", payFromAccountId: null };
    expect(await saveSplit({ ...split, walletId: ATOME, plan: { ...plan, ...patch } })).toEqual({
      error,
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("undoes the split when its payment plan can't be saved", async () => {
    useDb({ accounts });
    db.respond((q) => (q.table === "installment_plans" && q.op === "insert" ? fail() : undefined));
    expect(await saveSplit({ ...split, walletId: ATOME })).toEqual({
      error: "Couldn't save the payment plan. Please try again.",
    });
    expect(db.table("transactions")).toEqual([]);
  });

  it("someone else paid: only your share, as an expense from them and utang", async () => {
    useDb({ accounts });
    expect(
      await saveSplit({
        ...split,
        paidBy: { personId: ANA },
        walletId: null,
        others: [{ who: { name: "Carlo" }, amount: 600 }],
      }),
    ).toEqual({});
    expect(db.writes("accounts", "insert")).toEqual([]);
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "expense",
        amount: 300,
        account_id: ANA,
        category: "food",
        note: "Dinner (my share)",
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ person_id: ANA, kind: "split", split_total: 900 }),
    ]);
  });

  it("someone else paid: checks who", async () => {
    useDb({ accounts });
    expect(await saveSplit({ ...split, paidBy: { personId: CASH } })).toEqual({
      error: "Check who paid.",
    });
    expect(db.writeLog()).toEqual([]);
  });
});

// ── updateSplit ─────────────────────────────────────────────────────────

describe("updateSplit", () => {
  const records = (wallet = CASH) => [
    {
      id: E1,
      type: "expense",
      amount: 300,
      account_id: wallet,
      to_account_id: null,
      split_id: SPLIT,
      note: "Dinner (my share)",
      occurred_on: "2026-11-10",
    },
    {
      id: T1,
      type: "transfer",
      amount: 600,
      account_id: wallet,
      to_account_id: ANA,
      split_id: SPLIT,
      note: "Split: Dinner",
      occurred_on: "2026-11-10",
    },
  ];
  const seed = (wallet = CASH) => ({
    accounts,
    transactions: records(wallet),
    person_entries: [{ transaction_id: T1, person_id: ANA, kind: "split", split_total: 900 }],
  });
  const edit = {
    note: "Team dinner",
    occurredOn: "2026-11-12",
    shares: [
      { id: E1, amount: 400 },
      { id: T1, amount: 500 },
    ],
  };
  const plan = {
    id: "plan-1",
    kind: "bnpl",
    account_id: ATOME,
    name: "Dinner",
    principal: 900,
    fee_total: 0,
    months: 1,
    first_due: "2026-12-05",
    pay_from_account_id: null,
    source_txn_id: E1,
  };

  it("returns the signed-out error when there's no session", async () => {
    useDb(seed(), { user: null });
    expect(await updateSplit(SPLIT, edit)).toEqual({ error: SIGNED_OUT_ERROR });
    expect(db.writeLog()).toEqual([]);
  });

  it.each<[string, string, object, string]>([
    ["a bad split id", "nope", {}, "Couldn't find that split."],
    ["a bad date", SPLIT, { occurredOn: "2026-11-31" }, "Pick a date."],
    [
      "a negative share",
      SPLIT,
      {
        shares: [
          { id: E1, amount: -1 },
          { id: T1, amount: 600 },
        ],
      },
      "Check the shares.",
    ],
    [
      "a person added with no share",
      SPLIT,
      { added: [{ who: { name: "Ben" }, amount: 0 }] },
      "Enter a share above ₱0 for each person you add.",
    ],
    [
      "shares that add up to nothing",
      SPLIT,
      {
        shares: [
          { id: E1, amount: 0 },
          { id: T1, amount: 0 },
        ],
      },
      "The shares need to add up to more than ₱0.",
    ],
  ])("rejects %s without writing", async (_, id, patch, error) => {
    useDb(seed());
    expect(await updateSplit(id, { ...edit, ...patch })).toEqual({ error });
    expect(db.writeLog()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the split changed when the shares don't match its records", async () => {
    useDb(seed());
    expect(await updateSplit(SPLIT, { ...edit, shares: [{ id: E1, amount: 900 }] })).toEqual({
      error: "This split changed. Reload and try again.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("updates each share, the note and date, and the bill total on person entries", async () => {
    useDb(seed());
    expect(await updateSplit(SPLIT, edit)).toEqual({});
    expect(db.writes("transactions", "update")).toEqual([
      { amount: 400, occurred_on: "2026-11-12", note: "Team dinner (my share)" },
      { amount: 500, occurred_on: "2026-11-12", note: "Split: Team dinner" },
    ]);
    expect(db.writes("person_entries", "update")).toEqual([{ split_total: 900 }]);
    expect(db.table("person_entries")[0]).toMatchObject({ transaction_id: T1, split_total: 900 });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("deletes a share set to ₱0", async () => {
    useDb(seed());
    expect(
      await updateSplit(SPLIT, {
        ...edit,
        shares: [
          { id: E1, amount: 300 },
          { id: T1, amount: 0 },
        ],
      }),
    ).toEqual({});
    expect(db.table("transactions").map((t) => t.id)).toEqual([E1]);
    // No transfer left to carry the total.
    expect(db.writes("person_entries", "update")).toEqual([]);
  });

  it("adds someone new as pautang from the same wallet", async () => {
    useDb(seed());
    expect(
      await updateSplit(SPLIT, { ...edit, added: [{ who: { name: "Carlo" }, amount: 200 }] }),
    ).toEqual({});
    const carlo = db.table("accounts").find((a) => a.name === "Carlo")!;
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 200,
        account_id: CASH,
        to_account_id: carlo.id,
        note: "Split: Team dinner",
        occurred_on: "2026-11-12",
        split_id: SPLIT,
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ person_id: carlo.id, kind: "split", split_total: 1100 }),
    ]);
    expect(db.writes("person_entries", "update")).toEqual([{ split_total: 1100 }]);
  });

  it("won't add someone already on the bill", async () => {
    useDb(seed());
    expect(
      await updateSplit(SPLIT, { ...edit, added: [{ who: { name: " ana " }, amount: 200 }] }),
    ).toEqual({ error: "ana is already on this bill." });
    expect(db.writeLog()).toEqual([]);
  });

  it("a credit line's bill follows the new total while nothing's paid", async () => {
    useDb({
      ...seed(ATOME),
      installment_plans: [plan],
      scheduled_payments: [{ plan_id: "plan-1", transfer_txn_id: null, fee_txn_id: null }],
    });
    expect(
      await updateSplit(SPLIT, {
        ...edit,
        shares: [
          { id: E1, amount: 400 },
          { id: T1, amount: 600 },
        ],
      }),
    ).toEqual({});
    expect(db.table("installment_plans")).toEqual([
      expect.objectContaining({
        account_id: ATOME,
        name: "Team dinner",
        principal: 1000,
        first_due: "2026-12-05",
        source_txn_id: E1,
      }),
    ]);
  });

  it("moves the plan to a share that stays when its record is taken off", async () => {
    useDb({
      ...seed(ATOME),
      installment_plans: [plan],
      scheduled_payments: [{ plan_id: "plan-1", transfer_txn_id: null, fee_txn_id: null }],
    });
    expect(
      await updateSplit(SPLIT, {
        ...edit,
        shares: [
          { id: E1, amount: 0 },
          { id: T1, amount: 600 },
        ],
      }),
    ).toEqual({});
    expect(db.writes("installment_plans", "update")).toEqual([{ source_txn_id: T1 }]);
    expect(db.table("installment_plans")).toEqual([
      expect.objectContaining({ principal: 600, source_txn_id: T1 }),
    ]);
  });

  it("won't move a bill that's partly paid on its credit line", async () => {
    useDb({
      ...seed(ATOME),
      installment_plans: [plan],
      scheduled_payments: [{ plan_id: "plan-1", transfer_txn_id: "paid-1", fee_txn_id: null }],
    });
    expect((await updateSplit(SPLIT, { ...edit, walletId: CASH })).error).toMatch(
      /already paid on its credit line/,
    );
    expect(db.writes("transactions")).toEqual([]);
  });

  it("moves every record to another wallet", async () => {
    useDb(seed());
    expect(await updateSplit(SPLIT, { ...edit, walletId: BANK })).toEqual({});
    expect(db.writes("transactions", "update")).toEqual([
      expect.objectContaining({ amount: 400, account_id: BANK }),
      expect.objectContaining({ amount: 500, account_id: BANK }),
    ]);
  });

  it("won't move to a dollar wallet", async () => {
    useDb(seed());
    expect(await updateSplit(SPLIT, { ...edit, walletId: USD })).toEqual({
      error: "Pick a cash, bank or e-wallet account, or a credit line.",
    });
    expect(db.writeLog()).toEqual([]);
  });
});

// ── addSplitsToBill ─────────────────────────────────────────────────────

describe("addSplitsToBill", () => {
  const seed = (wallet = ATOME) => ({
    accounts,
    transactions: [
      {
        id: E1,
        type: "expense",
        amount: 300,
        account_id: wallet,
        note: "Dinner (my share)",
        occurred_on: "2026-11-10",
        split_id: SPLIT,
      },
      {
        id: T1,
        type: "transfer",
        amount: 600,
        account_id: wallet,
        note: "Split: Dinner",
        occurred_on: "2026-11-10",
        split_id: SPLIT,
      },
    ],
  });

  it("rejects bad ids before signing in", async () => {
    expect(await addSplitsToBill([])).toEqual({ error: "Couldn't find that split." });
    expect(await addSplitsToBill(["nope"])).toEqual({ error: "Couldn't find that split." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("puts the whole bill on the credit line's next bill as one payment", async () => {
    useDb(seed());
    expect(await addSplitsToBill([SPLIT])).toEqual({});
    expect(db.writes("installment_plans", "insert")).toEqual([
      {
        kind: "bnpl",
        account_id: ATOME,
        name: "Dinner",
        principal: 900,
        fee_total: 0,
        months: 1,
        first_due: "2026-12-05",
        pay_from_account_id: null,
        source_txn_id: E1,
      },
    ]);
  });

  it("skips a split that already has a plan", async () => {
    useDb({
      ...seed(),
      installment_plans: [{ id: "plan-1", source_txn_id: T1 }],
    });
    expect(await addSplitsToBill([SPLIT])).toEqual({});
    expect(db.writeLog()).toEqual([]);
  });

  it("only takes splits paid with a credit line", async () => {
    useDb(seed(CASH));
    expect(await addSplitsToBill([SPLIT])).toEqual({
      error: "That split wasn't paid with a credit line.",
    });
    expect(db.writeLog()).toEqual([]);
  });
});

// ── deleteSplit ─────────────────────────────────────────────────────────

describe("deleteSplit", () => {
  it("rejects a bad id before signing in", async () => {
    expect(await deleteSplit("nope")).toEqual({ error: "Couldn't find that split." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("deletes every record of the bill, nothing else", async () => {
    useDb({
      transactions: [
        { id: E1, split_id: SPLIT },
        { id: T1, split_id: SPLIT },
        { id: T2, split_id: null },
      ],
    });
    expect(await deleteSplit(SPLIT)).toEqual({});
    expect(db.table("transactions")).toEqual([{ id: T2, split_id: null }]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("fails when nothing was deleted", async () => {
    expect(await deleteSplit(SPLIT)).toEqual({ error: "Couldn't delete that. Please try again." });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ── renamePerson / restorePerson ────────────────────────────────────────

describe("renamePerson", () => {
  it("rejects a blank or long name before signing in", async () => {
    const error = "Check the name (up to 60 characters).";
    expect(await renamePerson(ANA, "   ", "")).toEqual({ error });
    expect(await renamePerson(ANA, "x".repeat(61), "")).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves the tidied name and contact, only on a person", async () => {
    useDb({ accounts });
    expect(await renamePerson(ANA, "  Ana   Cruz ", "  0917 555 ")).toEqual({ personId: ANA });
    expect(db.writes("accounts", "update")).toEqual([{ name: "Ana Cruz", contact: "0917 555" }]);
    expect(await renamePerson(ANA, "Ana", "   ")).toEqual({ personId: ANA });
    expect(db.writes("accounts", "update")[1]).toEqual({ name: "Ana", contact: null });
    // A wallet can't be renamed from here.
    expect(await renamePerson(CASH, "Ana", "")).toEqual(FAILED);
  });
});

describe("restorePerson", () => {
  it("unarchives a person", async () => {
    useDb({ accounts: [{ ...ana, archived: true }] });
    expect(await restorePerson(ANA)).toEqual({ personId: ANA });
    expect(db.table("accounts")[0]).toMatchObject({ archived: false });
  });

  it("fails for someone who isn't there", async () => {
    useDb({ accounts });
    expect(await restorePerson(CASH)).toEqual(FAILED);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ── deletePersonEntry ───────────────────────────────────────────────────

describe("deletePersonEntry", () => {
  it("rejects bad ids before signing in", async () => {
    expect(await deletePersonEntry("ana", T1)).toEqual({ error: "Couldn't find that." });
    expect(await deletePersonEntry(ANA, "t1")).toEqual({ error: "Couldn't find that." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("deletes a record of theirs", async () => {
    useDb({
      transactions: [{ id: T1, account_id: CASH, to_account_id: ANA, split_id: null }],
    });
    expect(await deletePersonEntry(ANA, T1)).toEqual({ personId: ANA });
    expect(db.table("transactions")).toEqual([]);
  });

  it("won't delete a record that isn't theirs", async () => {
    useDb({
      transactions: [{ id: T1, account_id: CASH, to_account_id: BEN, split_id: null }],
    });
    expect(await deletePersonEntry(ANA, T1)).toEqual({ error: "Couldn't find that." });
    expect(db.writeLog()).toEqual([]);
  });

  it("takes their share off a split bill: the total goes down", async () => {
    useDb({
      accounts,
      transactions: [
        {
          id: E1,
          type: "expense",
          amount: 300,
          account_id: CASH,
          to_account_id: null,
          split_id: SPLIT,
          note: "Dinner (my share)",
          occurred_on: "2026-11-10",
        },
        {
          id: T1,
          type: "transfer",
          amount: 600,
          account_id: CASH,
          to_account_id: ANA,
          split_id: SPLIT,
          note: "Split: Dinner",
          occurred_on: "2026-11-10",
        },
        {
          id: T2,
          type: "transfer",
          amount: 200,
          account_id: CASH,
          to_account_id: BEN,
          split_id: SPLIT,
          note: "Split: Dinner",
          occurred_on: "2026-11-10",
        },
      ],
      person_entries: [
        { transaction_id: T1, person_id: ANA, split_total: 1100 },
        { transaction_id: T2, person_id: BEN, split_total: 1100 },
      ],
    });
    expect(await deletePersonEntry(ANA, T1)).toEqual({ personId: ANA });
    expect(db.table("transactions").map((t) => [t.id, t.amount, t.note])).toEqual([
      [E1, 300, "Dinner (my share)"],
      [T2, 200, "Split: Dinner"],
    ]);
    expect(db.writes("person_entries", "update")).toEqual([{ split_total: 500 }]);
    expect(db.table("person_entries").find((e) => e.transaction_id === T2)).toMatchObject({
      split_total: 500,
    });
  });

  it("deletes the whole split when theirs is its last share", async () => {
    useDb({
      transactions: [
        { id: T1, amount: 600, account_id: CASH, to_account_id: ANA, split_id: SPLIT },
        { id: E1, amount: 0, account_id: CASH, to_account_id: null, split_id: SPLIT },
      ],
    });
    expect(await deletePersonEntry(ANA, T1)).toEqual({ personId: ANA });
    expect(db.table("transactions")).toEqual([]);
  });
});

// ── deletePerson ────────────────────────────────────────────────────────

describe("deletePerson", () => {
  it("rejects a bad id before signing in", async () => {
    expect(await deletePerson("ana", "remove")).toEqual({ error: "Couldn't find them." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the signed-out error when there's no session", async () => {
    useDb({ accounts }, { user: null });
    expect(await deletePerson(ANA, "remove")).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("deletes someone with no records outright", async () => {
    useDb({ accounts });
    expect(await deletePerson(ANA, "remove")).toEqual({});
    expect(db.table("accounts").some((a) => a.id === ANA)).toBe(false);
  });

  it("archives someone with records instead", async () => {
    useDb({ accounts });
    db.respond((q) =>
      q.table === "accounts" && q.op === "delete" ? fail("23503", "still referenced") : undefined,
    );
    expect(await deletePerson(ANA, "remove")).toEqual({ archived: true });
    expect(db.writes("accounts", "update")).toEqual([{ archived: true }]);
  });

  it("only deletes people", async () => {
    useDb({ accounts });
    expect(await deletePerson(CASH, "remove")).toEqual({ error: "Couldn't find them." });
    expect(db.writeLog()).toEqual([]);
  });

  it("forever: removes their records and their split shares, keeping yours", async () => {
    useDb({
      accounts,
      transactions: [
        { id: T2, amount: 1000, account_id: CASH, to_account_id: ANA, split_id: null },
        {
          id: E1,
          type: "expense",
          amount: 300,
          account_id: CASH,
          to_account_id: null,
          split_id: SPLIT,
          note: "Dinner (my share)",
          occurred_on: "2026-11-10",
        },
        {
          id: T1,
          type: "transfer",
          amount: 600,
          account_id: CASH,
          to_account_id: ANA,
          split_id: SPLIT,
          note: "Split: Dinner",
          occurred_on: "2026-11-10",
        },
      ],
    });
    // The fake doesn't apply .or(): answer it with just their records.
    db.respond((q) =>
      q.table === "transactions" && q.op === "select" && q.filters.some((f) => f.method === "or")
        ? {
            data: db
              .table("transactions")
              .filter((t) => t.account_id === ANA || t.to_account_id === ANA)
              .map((t) => ({ id: t.id, split_id: t.split_id })),
            error: null,
          }
        : undefined,
    );
    expect(await deletePerson(ANA, "forever")).toEqual({});
    expect(db.table("transactions").map((t) => [t.id, t.amount])).toEqual([[E1, 300]]);
    expect(db.table("accounts").some((a) => a.id === ANA)).toBe(false);
  });

  it("forever: not while they pay a plan in your name", async () => {
    useDb({ accounts, installment_plans: [{ id: "plan-1", name: "Phone", person_id: ANA }] });
    expect((await deletePerson(ANA, "forever")).error).toBe(
      "Ana pays Phone in your name. Remove that from the loan or credit line first, or archive Ana instead.",
    );
    expect(db.writeLog()).toEqual([]);
  });
});

// ── lendFromCreditLine ──────────────────────────────────────────────────

describe("lendFromCreditLine", () => {
  const input: CreditLendInput = {
    who: { personId: ANA },
    creditLineId: ATOME,
    note: "Phone",
    occurredOn: "2026-09-10",
    amount: 1100,
    fee: 100,
    months: 6,
    alreadyPaid: 2,
    nextDue: "2026-12-15",
    alreadyOwed: false,
  };

  it.each<[string, Partial<CreditLendInput>, string]>([
    ["no payment", { amount: 0 }, "Enter each payment."],
    ["a fee as big as the payment", { fee: 1100 }, "The fee has to be less than each payment."],
    ["a negative fee", { fee: -1 }, "The fee has to be less than each payment."],
    ["37 months", { months: 37 }, "Pick how many months."],
    ["part of a month", { months: 2.5 }, "Pick how many months."],
    [
      "every payment already made",
      { alreadyPaid: 6 },
      "Check how many payments they've already made.",
    ],
    ["a bad purchase date", { occurredOn: "x" }, "Pick when they bought it."],
    ["a bad due date", { nextDue: "2026-02-29" }, "Pick when the next payment is due."],
    [
      "a total past the limit",
      { amount: 6e11, fee: 0, months: 2, alreadyPaid: 0 },
      "That amount is too big.",
    ],
    ["a blank name", { who: { name: " " } }, "Who is it?"],
  ])("rejects %s before signing in", async (_, patch, error) => {
    expect(await lendFromCreditLine({ ...input, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the signed-out error when there's no session", async () => {
    useDb({ accounts }, { user: null });
    expect(await lendFromCreditLine(input)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("asks for step 19 before migration 0019", async () => {
    useDb({ accounts });
    db.respond((q) =>
      q.table === "installment_plans" && q.columns === "person_id" ? fail("42703") : undefined,
    );
    expect((await lendFromCreditLine(input)).error).toMatch(/run step 19/);
    expect(db.writeLog()).toEqual([]);
  });

  it("needs a credit line", async () => {
    useDb({ accounts });
    expect(await lendFromCreditLine({ ...input, creditLineId: CASH })).toEqual({
      error: "Pick a credit line.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("logs what's left as pautang from the line, and their plan on its bills", async () => {
    useDb({ accounts });
    expect(await lendFromCreditLine(input)).toEqual({ personId: ANA });
    const [txn] = db.table("transactions");
    // 4 payments left, ₱1,000 principal each.
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 4000,
        account_id: ATOME,
        to_account_id: ANA,
        note: "Phone (on Atome)",
        occurred_on: "2026-09-10",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      {
        transaction_id: txn.id,
        person_id: ANA,
        kind: "lend",
        due_on: "2027-03-15",
        count_in_forecast: false,
        split_total: null,
      },
    ]);
    expect(db.writes("installment_plans", "insert")).toEqual([
      {
        kind: "bnpl",
        account_id: ATOME,
        name: "Phone",
        principal: 6000,
        fee_total: 400,
        months: 6,
        first_due: "2026-12-15",
        pay_from_account_id: null,
        source_txn_id: txn.id,
        person_id: ANA,
      },
    ]);
    const [payments] = db.writes("scheduled_payments", "insert") as Row[][];
    expect(payments.map((p) => [p.seq, p.due_on, p.amount, p.principal_part, p.fee_part])).toEqual([
      [3, "2026-12-15", 1100, 1000, 100],
      [4, "2027-01-15", 1100, 1000, 100],
      [5, "2027-02-15", 1100, 1000, 100],
      [6, "2027-03-15", 1100, 1000, 100],
    ]);
    // Not already in what you owe: the starting balance stays.
    expect(db.writes("accounts", "update")).toEqual([]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("already owed: raises the line's starting balance so what you owe stays the same", async () => {
    useDb({ accounts });
    expect(await lendFromCreditLine({ ...input, alreadyOwed: true })).toEqual({ personId: ANA });
    expect(db.writes("accounts", "update")).toEqual([{ starting_balance: 6500 }]);
  });

  it("removes the pautang when the plan can't be saved", async () => {
    useDb({ accounts });
    db.respond((q) => (q.table === "installment_plans" && q.op === "insert" ? fail() : undefined));
    expect(await lendFromCreditLine(input)).toEqual(FAILED);
    expect(db.table("transactions")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("removes the pautang when the starting balance can't be raised", async () => {
    useDb({ accounts });
    db.respond((q) => (q.table === "accounts" && q.op === "update" ? fail() : undefined));
    expect(await lendFromCreditLine({ ...input, alreadyOwed: true })).toEqual(FAILED);
    expect(db.writeLog().at(-1)).toBe("delete transactions");
    expect(db.table("transactions")).toEqual([]);
  });
});

// ── assignPlanToPerson ──────────────────────────────────────────────────

describe("assignPlanToPerson", () => {
  const plan = {
    id: "plan-1",
    kind: "bnpl",
    account_id: ATOME,
    name: "Phone",
    source_txn_id: SRC,
    person_id: null,
  };
  const payments = (paidFirst = false) => [
    {
      plan_id: "plan-1",
      due_on: "2026-12-05",
      principal_part: 1000,
      transfer_txn_id: paidFirst ? "paid-1" : null,
      fee_txn_id: null,
    },
    {
      plan_id: "plan-1",
      due_on: "2027-02-05",
      principal_part: 1000,
      transfer_txn_id: null,
      fee_txn_id: null,
    },
    {
      plan_id: "plan-1",
      due_on: "2027-01-05",
      principal_part: 1000,
      transfer_txn_id: null,
      fee_txn_id: null,
    },
  ];
  const source = {
    id: SRC,
    type: "expense",
    amount: 3000,
    account_id: ATOME,
    to_account_id: null,
    category: "shopping",
    subcategory: "Gadgets",
    note: "Phone",
    split_id: null,
  };

  it("rejects a blank name before signing in", async () => {
    expect(await assignPlanToPerson("plan-1", { name: "  " })).toEqual({
      error: "Who is paying it?",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("finds the plan, and won't take one someone else pays", async () => {
    useDb({ accounts, installment_plans: [{ ...plan, person_id: BEN }] });
    expect(await assignPlanToPerson("plan-2", { personId: ANA })).toEqual({
      error: "Couldn't find that plan.",
    });
    expect(await assignPlanToPerson("plan-1", { personId: ANA })).toEqual({
      error: "Someone else already pays this one.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("nothing paid yet: the purchase itself becomes pautang to them", async () => {
    useDb({
      accounts,
      installment_plans: [plan],
      scheduled_payments: payments(),
      transactions: [source],
    });
    expect(await assignPlanToPerson("plan-1", { personId: ANA })).toEqual({ personId: ANA });
    expect(db.writes("transactions")).toEqual([
      {
        type: "transfer",
        to_account_id: ANA,
        category: null,
        note: "Phone (on Atome)",
        subcategory: null,
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      { transaction_id: SRC, person_id: ANA, kind: "lend", due_on: "2027-02-05" },
    ]);
    expect(db.writes("installment_plans", "update")).toEqual([{ person_id: ANA }]);
  });

  it("part paid: what's left is new pautang and the purchase keeps only the paid part", async () => {
    useDb({
      accounts,
      installment_plans: [plan],
      scheduled_payments: payments(true),
      transactions: [source],
    });
    expect(await assignPlanToPerson("plan-1", { personId: ANA })).toEqual({ personId: ANA });
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 2000,
        account_id: ATOME,
        to_account_id: ANA,
        note: "Phone (on Atome)",
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ kind: "lend", due_on: "2027-02-05" }),
    ]);
    expect(db.writes("transactions", "update")).toEqual([{ amount: 1000 }]);
    expect(db.writes("installment_plans", "update")).toEqual([{ person_id: ANA }]);
  });

  it("won't assign a split bill's plan", async () => {
    useDb({
      accounts,
      installment_plans: [plan],
      scheduled_payments: payments(),
      transactions: [{ ...source, split_id: SPLIT }],
    });
    expect(await assignPlanToPerson("plan-1", { personId: ANA })).toEqual({
      error: "This is a split bill: each person's share is already pautang.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("puts the purchase back when the person entry can't be saved", async () => {
    useDb({
      accounts,
      installment_plans: [plan],
      scheduled_payments: payments(),
      transactions: [source],
    });
    db.respond((q) => (q.table === "person_entries" && q.op === "insert" ? fail() : undefined));
    expect(await assignPlanToPerson("plan-1", { personId: ANA })).toEqual(FAILED);
    expect(db.table("transactions")[0]).toMatchObject({
      type: "expense",
      to_account_id: null,
      category: "shopping",
      note: "Phone",
    });
    expect(db.writes("installment_plans", "update")).toEqual([]);
  });

  // Regression: clearToTransfer clears the subcategory, and the rollback
  // used to leave it cleared.
  it("keeps the purchase's subcategory when that rollback happens", async () => {
    useDb({
      accounts,
      installment_plans: [plan],
      scheduled_payments: payments(),
      transactions: [source],
    });
    db.respond((q) => (q.table === "person_entries" && q.op === "insert" ? fail() : undefined));
    await assignPlanToPerson("plan-1", { personId: ANA });
    expect(db.table("transactions")[0]).toMatchObject({ subcategory: "Gadgets" });
  });
});

// ── addLoanForPerson ────────────────────────────────────────────────────

describe("addLoanForPerson", () => {
  const input: PersonLoanInput = {
    who: { personId: ANA },
    name: " MariLoan ",
    received: 10000,
    receivedOn: "2026-09-01",
    monthly: 2000,
    months: 6,
    nextDue: "2026-12-05",
    alreadyPaid: 2,
  };

  it.each<[string, Partial<PersonLoanInput>, string]>([
    ["no lender name", { name: "  " }, "Give the loan a name, like SLoan."],
    [
      "payments below what was received",
      { monthly: 1000 },
      "The payments add up to less than you received. Check the monthly payment and months.",
    ],
    ["a bad received date", { receivedOn: "2026-09-31" }, "Pick when they got the money."],
    ["a blank person", { who: { name: "" } }, "Who is the loan for?"],
  ])("rejects %s before signing in", async (_, patch, error) => {
    expect(await addLoanForPerson({ ...input, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("adds the loan, what's still owed as pautang, and their payments", async () => {
    useDb({ accounts });
    const result = await addLoanForPerson(input);
    const loan = db.table("accounts").find((a) => a.type === "loan")!;
    expect(result).toEqual({ personId: ANA, loanId: loan.id });
    expect(db.writes("accounts", "insert")).toEqual([
      { name: "MariLoan", type: "loan", starting_balance: 0 },
    ]);
    // ₱10,000 over 6: 1,666.66 × 5 and 1,666.70; 4 left after 2 paid.
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 6666.68,
        account_id: loan.id,
        to_account_id: ANA,
        note: "MariLoan loan",
        occurred_on: "2026-09-01",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ person_id: ANA, kind: "lend", due_on: "2027-03-05" }),
    ]);
    expect(db.writes("installment_plans", "insert")).toEqual([
      {
        kind: "loan",
        account_id: loan.id,
        name: "MariLoan",
        principal: 10000,
        fee_total: 1333.32,
        months: 6,
        first_due: "2026-12-05",
        pay_from_account_id: null,
        source_txn_id: null,
        person_id: ANA,
      },
    ]);
  });

  it("undoes the loan and pautang when the plan can't be saved", async () => {
    useDb({ accounts });
    db.respond((q) => (q.table === "installment_plans" && q.op === "insert" ? fail() : undefined));
    expect(await addLoanForPerson(input)).toEqual(FAILED);
    expect(db.table("transactions")).toEqual([]);
    expect(db.table("accounts").some((a) => a.type === "loan")).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ── theyPaidInstallments ────────────────────────────────────────────────

describe("theyPaidInstallments", () => {
  const plan = { id: "plan-1", account_id: ATOME, name: "Phone", months: 6, person_id: ANA };
  const payment = {
    id: "sp-3",
    plan_id: "plan-1",
    seq: 3,
    amount: 1100,
    principal_part: 1000,
    transfer_txn_id: null,
    fee_txn_id: null,
  };

  it("does nothing for no payments, and rejects a bad date, before signing in", async () => {
    expect(await theyPaidInstallments([])).toEqual({});
    expect(await theyPaidInstallments(["sp-3"], "nope")).toEqual({ error: "Pick a date." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("sends their money straight to the credit line and marks the payment paid", async () => {
    useDb({ installment_plans: [plan], scheduled_payments: [payment] });
    expect(await theyPaidInstallments(["sp-3"])).toEqual({});
    const [txn] = db.table("transactions");
    expect(db.writes("transactions", "insert")).toEqual([
      {
        type: "transfer",
        amount: 1000,
        account_id: ANA,
        to_account_id: ATOME,
        note: `Phone 3 of 6 · they paid ${formatPeso(1100)}`,
        occurred_on: "2026-11-19",
      },
    ]);
    expect(db.writes("person_entries", "insert")).toEqual([
      expect.objectContaining({ transaction_id: txn.id, person_id: ANA, kind: "payment" }),
    ]);
    expect(db.table("scheduled_payments")[0]).toMatchObject({ transfer_txn_id: txn.id });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("skips payments already made", async () => {
    useDb({
      installment_plans: [plan],
      scheduled_payments: [{ ...payment, transfer_txn_id: "done" }],
    });
    expect(await theyPaidInstallments(["sp-3"])).toEqual({});
    expect(db.writeLog()).toEqual([]);
  });

  it("won't mark your own plan as theirs", async () => {
    useDb({ installment_plans: [{ ...plan, person_id: null }], scheduled_payments: [payment] });
    expect(await theyPaidInstallments(["sp-3"])).toEqual({
      error: "That one's yours to pay: use Pay bill.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("doesn't count it twice when it was paid in another tab meanwhile", async () => {
    useDb({ installment_plans: [plan], scheduled_payments: [payment] });
    db.respond((q) =>
      q.table === "scheduled_payments" && q.op === "update" ? { data: [], error: null } : undefined,
    );
    expect(await theyPaidInstallments(["sp-3"])).toEqual({});
    expect(db.table("transactions")).toEqual([]);
  });

  it("fails when the payment can't be found", async () => {
    useDb({ installment_plans: [plan] });
    expect(await theyPaidInstallments(["sp-9"])).toEqual({ error: "Couldn't find that payment." });
  });
});

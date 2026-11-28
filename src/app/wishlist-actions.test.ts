import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import { makeWishReal, removeWish, reopenWish, saveWish, type WishInput } from "./wishlist-actions";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: FakeSupabase;
function useDb(seed?: Parameters<typeof fakeSupabase>[0]) {
  db = fakeSupabase(seed);
  vi.mocked(createClient).mockResolvedValue(db.client);
  return db;
}

const trip = {
  id: "w1",
  name: "Siargao trip",
  amount: 18000,
  category: "fun",
  earliest: "2026-12-01",
  by_date: null,
  fee_rate: 2,
  status: "idea",
};

const spay = {
  id: "spay",
  name: "SPayLater",
  type: "credit_line",
  archived: false,
  currency: "PHP",
  due_day: 5,
  cutoff_day: 25,
  created_at: "1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
  useDb({ wishlist_items: [trip], accounts: [spay] });
});
afterEach(() => vi.useRealTimers());

describe("saveWish", () => {
  const input: WishInput = {
    name: "  New   phone ",
    amount: 24000,
    category: "shopping",
    earliest: "2026-12-01",
    by: "2027-01-31",
    feeRate: 0,
  };

  it.each<[string, Partial<WishInput>, string]>([
    ["no name", { name: "  " }, "What is it? Give it a name."],
    ["long name", { name: "x".repeat(51) }, "Keep the name to 50 characters."],
    ["zero amount", { amount: 0 }, "Enter an amount above ₱0."],
    ["income category", { category: "salary" }, "Pick a category."],
    ["bad date", { earliest: "soon" }, "Pick the save from date."],
    [
      "by before earliest",
      { by: "2026-11-30" },
      'The "ready by" date has to be on or after the "save from" date.',
    ],
    ["fee over 10%", { feeRate: 12 }, "Check the monthly fee (0 to 10%)."],
  ])("rejects %s before signing in", async (_, patch, error) => {
    expect(await saveWish({ ...input, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("adds a plan, tidying the name", async () => {
    expect(await saveWish(input)).toEqual({});
    expect(db.writes("wishlist_items", "insert")).toEqual([
      {
        name: "New phone",
        amount: 24000,
        category: "shopping",
        earliest: "2026-12-01",
        by_date: "2027-01-31",
        fee_rate: 0,
      },
    ]);
  });

  it("changes one, which makes it an idea again", async () => {
    expect(await saveWish({ ...input, by: null }, "w1")).toEqual({});
    expect(db.writes("wishlist_items", "update")).toEqual([
      expect.objectContaining({ name: "New phone", by_date: null, status: "idea" }),
    ]);
  });

  it("asks for the migration when the table isn't there", async () => {
    db.respond((q) => (q.table === "wishlist_items" ? fail("PGRST205", "no table") : undefined));
    expect(await saveWish(input)).toEqual({
      error: "To use your wishlist, run step 29 in supabase/SQL_GUIDE.md first.",
    });
  });
});

const parts = [
  { id: "p1", wish_id: "w1", transaction_id: "t1" },
  { id: "p2", wish_id: "w1", transaction_id: null },
  { id: "p3", wish_id: "w1", transaction_id: null },
  { id: "other", wish_id: null, transaction_id: null },
];

describe("removeWish", () => {
  it("removes it, and says so when it's gone already", async () => {
    expect(await removeWish("w1")).toEqual({});
    expect(await removeWish("w1")).toEqual({
      error: "Couldn't remove that plan. Please try again.",
    });
  });

  it("takes its unpaid payments with it, keeping the paid ones", async () => {
    useDb({ wishlist_items: [{ ...trip, status: "scheduled" }], planned_expenses: parts });
    expect(await removeWish("w1")).toEqual({});
    expect(db.table("planned_expenses").map((r) => r.id)).toEqual(["p1", "other"]);
    expect(db.table("wishlist_items")).toEqual([]);
  });
});

describe("reopenWish", () => {
  it("takes its unpaid payments out of Scheduled and makes it an idea again", async () => {
    useDb({ wishlist_items: [{ ...trip, status: "scheduled" }], planned_expenses: parts });
    expect(await reopenWish("w1")).toEqual({});
    expect(db.table("planned_expenses").map((r) => r.id)).toEqual(["p1", "other"]);
    expect(db.table("wishlist_items")[0].status).toBe("idea");
  });
});

describe("makeWishReal", () => {
  const planned = () => db.writes("planned_expenses", "insert")[0] as Record<string, unknown>[];

  it("pays in full: one planned expense on the date", async () => {
    expect(await makeWishReal("w1", { date: "2027-03-15", strategy: { kind: "full" } })).toEqual(
      {},
    );
    expect(planned()).toEqual([
      expect.objectContaining({ name: "Siargao trip", amount: 18000, due_on: "2027-03-15" }),
    ]);
    expect(db.writes("wishlist_items", "update")).toEqual([{ status: "scheduled" }]);
    expect(planned()[0].wish_id).toBe("w1");
  });

  it("in parts from your wallets: one a month", async () => {
    await makeWishReal("w1", { date: "2027-03-15", strategy: { kind: "installments", months: 3 } });
    expect(planned().map((r) => [r.name, r.amount, r.due_on])).toEqual([
      ["Siargao trip (1 of 3)", 6000, "2027-03-15"],
      ["Siargao trip (2 of 3)", 6000, "2027-04-15"],
      ["Siargao trip (3 of 3)", 6000, "2027-05-15"],
    ]);
  });

  it("on credit: the line's bills, with the plan's fee", async () => {
    await makeWishReal("w1", {
      date: "2026-12-01",
      strategy: { kind: "credit", lineId: "spay", months: 3 },
    });
    // 2% a month × 3 of ₱18,000 = ₱1,080 in fees, ₱360 in each.
    expect(planned().map((r) => [r.name, r.amount, r.due_on])).toEqual([
      ["Siargao trip · SPayLater (1 of 3)", 6360, "2027-01-05"],
      ["Siargao trip · SPayLater (2 of 3)", 6360, "2027-02-05"],
      ["Siargao trip · SPayLater (3 of 3)", 6360, "2027-03-05"],
    ]);
  });

  it("checks the way to pay, and doesn't do one twice", async () => {
    expect(
      await makeWishReal("w1", {
        date: "2027-03-15",
        strategy: { kind: "installments", months: 25 },
      }),
    ).toEqual({ error: "Pick a way to pay." });
    expect(
      await makeWishReal("w1", {
        date: "2027-03-15",
        strategy: { kind: "credit", lineId: "spay", months: 5 },
      }),
    ).toEqual({ error: "Pick a way to pay." });
    expect(await makeWishReal("w1", { date: "nope", strategy: { kind: "full" } })).toEqual({
      error: "Pick a date.",
    });
    useDb({ wishlist_items: [{ ...trip, status: "scheduled" }] });
    expect(await makeWishReal("w1", { date: "2027-03-15", strategy: { kind: "full" } })).toEqual({
      error: "That plan is already in Scheduled.",
    });
    expect(db.writes("planned_expenses", "insert")).toEqual([]);
  });

  const savingsWallet = {
    id: "save",
    name: "Long Term Savings",
    type: "bank",
    purpose: "savings",
    archived: false,
    currency: "PHP",
    created_at: "2",
  };
  const cash = { ...savingsWallet, id: "cash", name: "Cash", type: "cash", purpose: "spending" };
  const setAsides = [
    { dueOn: "2027-01-15", amount: 6000 },
    { dueOn: "2027-01-30", amount: 6000 },
    { dueOn: "2027-02-15", amount: 6000 },
  ];

  it("saving up: one set-aside per payday into the savings wallet", async () => {
    useDb({ wishlist_items: [trip], accounts: [spay, savingsWallet] });
    expect(
      await makeWishReal("w1", {
        date: "2027-01-15",
        strategy: { kind: "save" },
        payments: setAsides,
        toAccountId: "save",
      }),
    ).toEqual({});
    expect(planned().map((r) => [r.type, r.name, r.amount, r.due_on, r.to_account_id])).toEqual([
      ["set_aside", "Siargao trip · set aside (1 of 3)", 6000, "2027-01-15", "save"],
      ["set_aside", "Siargao trip · set aside (2 of 3)", 6000, "2027-01-30", "save"],
      ["set_aside", "Siargao trip · set aside (3 of 3)", 6000, "2027-02-15", "save"],
    ]);
    expect(planned()[0].wish_id).toBe("w1");
    expect(db.writes("wishlist_items", "update")).toEqual([{ status: "scheduled" }]);
  });

  it("saving up: checks the set-asides add up and go into a savings wallet", async () => {
    useDb({ wishlist_items: [trip], accounts: [spay, savingsWallet, cash] });
    const save = (payments: typeof setAsides, toAccountId = "save") =>
      makeWishReal("w1", { date: "2027-01-15", strategy: { kind: "save" }, payments, toAccountId });
    const short = { error: "Those set-asides don't add up. Refresh and try again." };
    expect(await save(setAsides.slice(1))).toEqual(short);
    expect(await save([...setAsides].reverse())).toEqual(short);
    expect(await save([{ dueOn: "2026-11-01", amount: 18000 }])).toEqual(short);
    expect(await save(setAsides, "cash")).toEqual({ error: "Pick one of your savings wallets." });
    expect(await save(setAsides, "spay")).toEqual({ error: "Pick one of your savings wallets." });
    expect(db.writes("planned_expenses", "insert")).toEqual([]);
    expect(db.writes("wishlist_items", "update")).toEqual([]);
  });

  it("saving up: says to run step 31 before it can", async () => {
    useDb({ wishlist_items: [trip], accounts: [spay, savingsWallet] });
    db.respond((q) =>
      q.table === "planned_expenses" && q.op === "insert"
        ? { data: null, error: { code: "23514", message: "check" } }
        : undefined,
    );
    expect(
      await makeWishReal("w1", {
        date: "2027-01-15",
        strategy: { kind: "save" },
        payments: setAsides,
        toAccountId: "save",
      }),
    ).toEqual({ error: "To save up for a plan, run step 31 in supabase/SQL_GUIDE.md first." });
    expect(db.writes("wishlist_items", "update")).toEqual([]);
  });

  it("leaves the plan an idea when saving fails", async () => {
    expect(await makeWishReal("w1", { date: "2026-11-01", strategy: { kind: "full" } })).toEqual({
      error: "Pick today or a later date.",
    });
    expect(db.writes("wishlist_items", "update")).toEqual([]);
  });
});

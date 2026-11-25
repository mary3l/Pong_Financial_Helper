import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  removePlanPayments,
  removeScheduled,
  saveScheduled,
  type ScheduledInput,
} from "./schedule-actions";

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

const internet: ScheduledInput = {
  flow: "out",
  name: "  PLDT   fiber ",
  amount: 1699,
  amountVaries: false,
  category: "bills",
  accountId: "bank",
  repeat: "monthly",
  date: null,
  day1: 12,
  day2: null,
  endsOn: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("saveScheduled", () => {
  it.each<[string, Partial<ScheduledInput>, string]>([
    ["no name", { name: " " }, "Give it a name."],
    ["long name", { name: "x".repeat(61) }, "Keep the name to 60 characters."],
    ["zero amount", { amount: 0 }, "Enter an amount above ₱0."],
    ["bad flow", { flow: "sideways" as never }, "Pick income or expense."],
    ["income category on a bill", { category: "salary" }, "Pick a category."],
    ["once with no date", { repeat: "once", date: null }, "Pick a date."],
    ["every work day", { repeat: "daily" }, "Check the dates it repeats on."],
    ["day 32", { day1: 32 }, "Check the dates it repeats on."],
    ["bad end date", { endsOn: "someday" }, "Check the end date, or leave it blank."],
  ])("rejects %s", async (_, patch, error) => {
    expect(await saveScheduled({ ...internet, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await saveScheduled(internet)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("adds a recurring bill", async () => {
    expect(await saveScheduled(internet)).toEqual({});
    expect(db.writes("recurring_items", "insert")).toEqual([
      {
        kind: "bill",
        name: "PLDT fiber",
        amount: 1699,
        amount_varies: false,
        category: "bills",
        account_id: "bank",
        frequency: "monthly",
        day1: 12,
        day2: null,
        ends_on: null,
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("adds a one-off as a planned expense", async () => {
    expect(
      await saveScheduled({
        ...internet,
        flow: "in",
        category: "salary",
        repeat: "once",
        date: "2026-12-20",
      }),
    ).toEqual({});
    expect(db.writes("planned_expenses", "insert")).toEqual([
      expect.objectContaining({ type: "income", due_on: "2026-12-20", name: "PLDT fiber" }),
    ]);
  });

  it("updates in place when the kind didn't change", async () => {
    useDb({ recurring_items: [{ id: "r1", kind: "bill" }] });
    expect(await saveScheduled(internet, { table: "recurring", id: "r1" })).toEqual({});
    expect(db.writeLog()).toEqual(["update recurring_items"]);
  });

  it("moves it to the other table when it becomes one-off", async () => {
    useDb({ recurring_items: [{ id: "r1", kind: "bill" }] });
    expect(
      await saveScheduled(
        { ...internet, repeat: "once", date: "2026-12-12" },
        { table: "recurring", id: "r1" },
      ),
    ).toEqual({});
    expect(db.writeLog()).toEqual(["insert planned_expenses", "delete recurring_items"]);
    expect(db.table("recurring_items")).toEqual([]);
  });
});

describe("removeScheduled", () => {
  it("never deletes the payday", async () => {
    useDb({ recurring_items: [{ id: "pay", kind: "payday" }] });
    expect(await removeScheduled({ table: "recurring", id: "pay" })).toEqual({
      error: "Couldn't remove that. Please try again.",
    });
    expect(db.table("recurring_items")).toHaveLength(1);
  });

  it("deletes a planned item", async () => {
    useDb({ planned_expenses: [{ id: "p1" }] });
    expect(await removeScheduled({ table: "planned", id: "p1" })).toEqual({});
    expect(db.table("planned_expenses")).toEqual([]);
  });

  it("puts a plan back in your ideas when its last payment goes", async () => {
    useDb({
      wishlist_items: [{ id: "w1", status: "scheduled" }],
      planned_expenses: [
        { id: "p1", wish_id: "w1", transaction_id: null },
        { id: "p2", wish_id: "w1", transaction_id: null },
      ],
    });
    await removeScheduled({ table: "planned", id: "p1" });
    expect(db.table("wishlist_items")[0].status).toBe("scheduled");
    await removeScheduled({ table: "planned", id: "p2" });
    expect(db.table("wishlist_items")[0].status).toBe("idea");
  });
});

describe("removePlanPayments", () => {
  it("removes a plan's unpaid payments; with none paid, it's an idea again", async () => {
    useDb({
      wishlist_items: [{ id: "w1", status: "scheduled" }],
      planned_expenses: [
        { id: "p1", wish_id: "w1", transaction_id: null },
        { id: "p2", wish_id: "w1", transaction_id: null },
        { id: "mine", wish_id: null, transaction_id: null },
      ],
    });
    expect(await removePlanPayments("w1")).toEqual({});
    expect(db.table("planned_expenses").map((r) => r.id)).toEqual(["mine"]);
    expect(db.table("wishlist_items")[0].status).toBe("idea");
  });

  it("keeps the plan made real when some of it was paid", async () => {
    useDb({
      wishlist_items: [{ id: "w1", status: "scheduled" }],
      planned_expenses: [
        { id: "p1", wish_id: "w1", transaction_id: "t1" },
        { id: "p2", wish_id: "w1", transaction_id: null },
      ],
    });
    expect(await removePlanPayments("w1")).toEqual({});
    expect(db.table("planned_expenses").map((r) => r.id)).toEqual(["p1"]);
    expect(db.table("wishlist_items")[0].status).toBe("scheduled");
  });
});

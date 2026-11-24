import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { addDays, today } from "@/lib/dates";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import { removeGoal, saveGoal, type GoalInput } from "./goal-actions";

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

const grab = (): GoalInput => ({
  category: "transport",
  subcategory: "  Grab ",
  limit: 1500.004,
  endsOn: addDays(today(), 7),
});

const GOAL_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("saveGoal", () => {
  it.each<[string, Partial<GoalInput>, string]>([
    ["an unknown category", { category: "yachts" }, "Pick a category."],
    ["no amount", { limit: 0 }, "Enter an amount above ₱0."],
    ["a past end", { endsOn: addDays(today(), -1) }, "Pick an end date from today on."],
    ["a bad date", { endsOn: "2026-02-30" }, "Pick an end date from today on."],
    ["more than a year", { endsOn: addDays(today(), 367) }, "Keep a goal to a year or less."],
    [
      "a long subcategory",
      { subcategory: "x".repeat(41) },
      "Keep the subcategory to 40 characters.",
    ],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await saveGoal({ ...grab(), ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves it starting today, with the subcategory tidied", async () => {
    expect(await saveGoal(grab())).toEqual({});
    expect(db.table("spending_goals")).toEqual([
      expect.objectContaining({
        category: "transport",
        subcategory: "Grab",
        limit_amount: 1500,
        starts_on: today(),
        ends_on: addDays(today(), 7),
      }),
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("can be for a whole category, and one of your own", async () => {
    useDb({ user_categories: [{ id: "c1", type: "expense", key: "u_milk_tea" }] });
    expect(await saveGoal({ ...grab(), category: "u_milk_tea", subcategory: "" })).toEqual({});
    expect(db.table("spending_goals")[0]).toMatchObject({
      category: "u_milk_tea",
      subcategory: null,
    });
  });

  it("needs a session, and asks for step 28 before the table is there", async () => {
    useDb({}, { user: null });
    expect(await saveGoal(grab())).toEqual({ error: SIGNED_OUT_ERROR });
    useDb();
    db.respond((q) => (q.table === "spending_goals" ? fail("PGRST205", "no table") : undefined));
    expect(await saveGoal(grab())).toEqual({
      error: "To save goals, run step 28 in supabase/SQL_GUIDE.md first.",
    });
  });
});

describe("removeGoal", () => {
  it("removes one, and says so when it's gone already", async () => {
    useDb({ spending_goals: [{ id: GOAL_ID }] });
    expect(await removeGoal(GOAL_ID)).toEqual({});
    expect(await removeGoal(GOAL_ID)).toEqual({
      error: "Couldn't remove that goal. Please try again.",
    });
  });

  it("refuses an id that isn't one", async () => {
    expect(await removeGoal("nope")).toEqual({
      error: "Couldn't remove that goal. Please try again.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});

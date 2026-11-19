import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import { finishSetup, savePaydayAndBills, type PaydayInput } from "./setup-actions";

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

const input: PaydayInput = {
  schedule: { frequency: "twice_monthly", day1: 15, day2: 30 },
  amount: 15000.005,
  accountId: "bank",
  bills: [{ name: " Rent ", amount: 8000, day: 5, accountId: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("savePaydayAndBills", () => {
  it.each<[string, Partial<PaydayInput>, string]>([
    [
      "bad schedule",
      { schedule: { frequency: "monthly", day1: 0, day2: null } },
      "Check your payday dates.",
    ],
    ["negative pay", { amount: -1 }, "Check your net pay, or leave it blank."],
    [
      "unnamed bill",
      { bills: [{ name: " ", amount: 1, day: 1, accountId: null }] },
      "Give each bill a name.",
    ],
    [
      "bill with no amount",
      { bills: [{ name: "Water", amount: 0, day: 1, accountId: null }] },
      "Add an amount for Water. A guess is fine.",
    ],
    [
      "bill due on the 32nd",
      { bills: [{ name: "Water", amount: 300, day: 32, accountId: null }] },
      "Pick the day Water is due.",
    ],
  ])("rejects %s", async (_, patch, error) => {
    expect(await savePaydayAndBills({ ...input, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await savePaydayAndBills(input)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("replaces the payday, saves the bills and marks setup done", async () => {
    useDb({
      recurring_items: [
        { id: "old-pay", kind: "payday" },
        { id: "gone", kind: "bill", frequency: "monthly", payroll_key: null },
        { id: "sss", kind: "bill", frequency: "monthly", payroll_key: "sss" },
      ],
    });
    expect(await savePaydayAndBills(input)).toEqual({});

    expect(db.writes("recurring_items", "insert")).toEqual([
      {
        kind: "payday",
        name: "Payday",
        amount: 15000.01,
        amount_varies: false,
        account_id: "bank",
        frequency: "twice_monthly",
        day1: 15,
        day2: 30,
      },
      {
        kind: "bill",
        name: "Rent",
        amount: 8000,
        account_id: null,
        frequency: "monthly",
        day1: 5,
        day2: null,
      },
    ]);
    const ids = db.table("recurring_items").map((r) => r.id);
    // The old payday and the dropped bill go; payroll's own bill stays.
    expect(ids).not.toContain("old-pay");
    expect(ids).not.toContain("gone");
    expect(ids).toContain("sss");

    expect(db.auth.updateUser).toHaveBeenCalledWith({ data: { setup_done: true } });
    expect(db.auth.refreshSession).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("updates a bill that's already saved", async () => {
    useDb({ recurring_items: [{ id: "b1", kind: "bill", frequency: "monthly" }] });
    await savePaydayAndBills({ ...input, bills: [{ ...input.bills[0], id: "b1" }] });
    expect(db.writes("recurring_items", "update")).toEqual([
      expect.objectContaining({ name: "Rent", amount: 8000, day1: 5 }),
    ]);
    expect(db.table("recurring_items").find((r) => r.id === "b1")).toBeDefined();
  });

  it("asks for migration 0022 before saving which Fridays pay", async () => {
    db.respond((q) => (q.op === "select" && q.columns?.includes("pay_weeks") ? fail() : undefined));
    const result = await savePaydayAndBills({
      ...input,
      schedule: { frequency: "weekly", day1: 5, day2: null, weeks: [1, 3] },
    });
    expect(result.error).toMatch(/run step 22/);
    // Nothing deleted before the check.
    expect(db.writeLog()).toEqual([]);
  });

  it("stops when the payday can't be saved", async () => {
    db.respond((q) => (q.op === "insert" ? fail() : undefined));
    expect(await savePaydayAndBills(input)).toEqual({
      error: "Couldn't save that. Please try again.",
    });
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("finishSetup", () => {
  it("doesn't touch the session when setup is already done", async () => {
    useDb({}, { user: { sub: "u1", user_metadata: { setup_done: true } } });
    expect(await finishSetup()).toEqual({});
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("reports a failed update", async () => {
    db.auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: "x" } });
    expect(await finishSetup()).toEqual({ error: "Couldn't finish setup. Please try again." });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  addWallets,
  removeWallet,
  restoreWallet,
  updateWallet,
  type WalletInput,
} from "./wallet-actions";

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

const gcash: WalletInput = { name: "  GCash  main ", type: "ewallet", balance: 1500.555 };

beforeEach(() => {
  vi.clearAllMocks();
  // 10:00 in Manila on 19 Nov 2026.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
  useDb();
});
afterEach(() => vi.useRealTimers());

describe("addWallets", () => {
  it.each<[string, Partial<WalletInput>, RegExp]>([
    ["no name", { name: "  " }, /Give each wallet a name/],
    ["long name", { name: "x".repeat(61) }, /60 characters/],
    ["unknown type", { type: "vault" as never }, /Pick a type/],
    ["infinite balance", { balance: Infinity }, /Check the amount/],
    ["interest on cash", { type: "cash", interestRate: 3 }, /Only banks and e-wallets/],
    ["0% interest", { interestRate: 0 }, /Check the interest rate/],
    ["dollars with no rate", { currency: "USD", purpose: "savings" }, /pesos US\$1 is/],
    [
      "dollars as spending money",
      { currency: "USD", fxRate: 58, purpose: "spending" },
      /Dollars aren't spending money/,
    ],
    ["goal date without goal", { goalDate: "2027-01-01" }, /saving for before picking a date/],
    [
      "time deposit with no maturity",
      { type: "bank", interestRate: 5, interestPayout: "maturity" },
      /matures/,
    ],
  ])("rejects %s", async (_, patch, error) => {
    expect((await addWallets([gcash, { ...gcash, ...patch }])).error).toMatch(error);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list", async () => {
    expect(await addWallets([])).toEqual({});
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the signed-out error", async () => {
    useDb({}, { user: null });
    expect(await addWallets([gcash])).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("inserts every wallet in one go", async () => {
    expect(
      await addWallets([
        gcash,
        { name: "Maya", type: "ewallet", balance: 0, interestRate: 3.5, purpose: "savings" },
      ]),
    ).toEqual({});
    expect(db.writes("accounts", "insert")).toEqual([
      [
        { name: "GCash main", type: "ewallet", starting_balance: 1500.56 },
        {
          name: "Maya",
          type: "ewallet",
          starting_balance: 0,
          purpose: "savings",
          interest_rate: 3.5,
          interest_since: "2026-11-19",
        },
      ],
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks for the migration when a column is missing", async () => {
    db.respond(() => fail("PGRST204", "Could not find the 'goal_amount' column"));
    expect((await addWallets([gcash])).error).toMatch(/run step 16/);
  });
});

describe("updateWallet", () => {
  const seed = () => ({
    accounts: [
      { id: "w1", name: "GCash", type: "ewallet", starting_balance: 1000, currency: "PHP" },
    ],
    account_balances: [{ account_id: "w1", balance: 1200 }],
  });

  it("can't update a wallet it can't find", async () => {
    expect(await updateWallet("nope", gcash)).toEqual({ error: "Couldn't find that wallet." });
  });

  it("moves the starting balance so past transactions stay", async () => {
    useDb(seed());
    // Now 1500.555 instead of 1200: starting goes up by the same 300.555.
    expect(await updateWallet("w1", gcash)).toEqual({});
    expect(db.writes("accounts", "update")).toEqual([
      { name: "GCash main", type: "ewallet", starting_balance: 1300.56 },
    ]);
  });

  it("checks the wallet against the currency it already has", async () => {
    const s = seed();
    s.accounts[0].currency = "USD";
    useDb(s);
    expect((await updateWallet("w1", { ...gcash, purpose: "savings" })).error).toMatch(/US\$1/);
    expect(db.writeLog()).toEqual([]);
  });
});

describe("removeWallet", () => {
  it("deletes a wallet that was never used", async () => {
    useDb({ accounts: [{ id: "w1" }] });
    expect(await removeWallet("w1")).toEqual({});
    expect(db.table("accounts")).toEqual([]);
  });

  it("archives a wallet that has history", async () => {
    useDb({ accounts: [{ id: "w1", archived: false }] });
    db.respond((q) => (q.op === "delete" ? fail("23503", "still referenced") : undefined));
    expect(await removeWallet("w1")).toEqual({ archived: true });
    expect(db.writes("accounts", "update")).toEqual([{ archived: true }]);
  });

  it("reports other failures", async () => {
    db.respond(() => fail());
    expect(await removeWallet("w1")).toEqual({
      error: "Couldn't remove that wallet. Please try again.",
    });
  });
});

describe("restoreWallet", () => {
  it("un-archives", async () => {
    useDb({ accounts: [{ id: "w1", archived: true }] });
    expect(await restoreWallet("w1")).toEqual({});
    expect(db.table("accounts")[0].archived).toBe(false);
  });
});

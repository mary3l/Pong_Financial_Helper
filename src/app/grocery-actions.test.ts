import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import { saveGroceryTrip, type TripInput } from "./grocery-actions";

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

const trip: TripInput = {
  store: "  SM   Hypermarket ",
  budget: 2000,
  accountId: "cash",
  receiptTotal: 254.5,
  occurredOn: "2026-11-19",
  items: [
    { barcode: "4800016", name: "Milk", price: 95.25, qty: 2 },
    { barcode: null, name: "  ", price: 64, qty: 1 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useDb({
    accounts: [
      { id: "cash", type: "cash" },
      { id: "loan", type: "loan" },
    ],
  });
});

describe("saveGroceryTrip", () => {
  it.each<[string, Partial<TripInput>, string]>([
    ["no receipt total", { receiptTotal: 0 }, "Type the total on your receipt."],
    ["bad date", { occurredOn: "" }, "Pick a date."],
    ["zero budget", { budget: 0 }, "Check the trip budget."],
    [
      "too many items",
      {
        items: Array.from({ length: 301 }, () => ({ barcode: null, name: "x", price: 1, qty: 1 })),
      },
      "That's a lot of items! Save at most 300.",
    ],
    [
      "free item",
      { items: [{ barcode: null, name: "x", price: 0, qty: 1 }] },
      "Check the prices and quantities.",
    ],
    [
      "1000 of one item",
      { items: [{ barcode: null, name: "x", price: 1, qty: 1000 }] },
      "Check the prices and quantities.",
    ],
  ])("rejects %s", async (_, patch, error) => {
    expect(await saveGroceryTrip({ ...trip, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    useDb({}, { user: null });
    expect(await saveGroceryTrip(trip)).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("won't pay with a loan", async () => {
    expect(await saveGroceryTrip({ ...trip, accountId: "loan" })).toEqual({
      error: "Pick what you paid with.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("saves one expense, the trip, prices and items", async () => {
    expect(await saveGroceryTrip(trip)).toEqual({});
    const [txn] = db.table("transactions");
    expect(txn).toMatchObject({
      type: "expense",
      amount: 254.5,
      category: "groceries",
      note: "Groceries · SM Hypermarket",
    });
    const [t] = db.table("grocery_trips");
    expect(t).toMatchObject({
      scanned_total: 254.5,
      transaction_id: txn.id,
      store: "SM Hypermarket",
    });

    const [product] = db.table("products");
    expect(product).toMatchObject({ barcode: "4800016", name: "Milk" });
    expect(db.writes("product_prices")).toEqual([
      [{ product_id: product.id, store: "SM Hypermarket", price: 95.25 }],
    ]);
    expect(db.writes("grocery_items")).toEqual([
      [
        { trip_id: t.id, product_id: product.id, name: "Milk", price: 95.25, qty: 2 },
        { trip_id: t.id, product_id: null, name: "Item", price: 64, qty: 1 },
      ],
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("deletes the expense when the items can't be saved", async () => {
    db.respond((q) => (q.table === "grocery_items" ? fail() : undefined));
    expect((await saveGroceryTrip(trip)).error).toMatch(/Couldn't save your groceries/);
    expect(db.table("transactions")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

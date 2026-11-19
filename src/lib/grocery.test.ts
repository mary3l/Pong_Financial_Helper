import { describe, expect, it } from "vitest";
import {
  addToCart,
  budgetStatus,
  cartCount,
  cartTotal,
  receiptNote,
  rememberedPrice,
  scanNote,
} from "@/lib/grocery";

describe("grocery mode", () => {
  it("stacks the same item and totals the cart", () => {
    let items = addToCart([], { barcode: "480", name: "Rice 5 kg", price: 320 }, "a");
    items = addToCart(items, { barcode: "480", name: "Rice 5 kg", price: 320 }, "b");
    items = addToCart(items, { barcode: null, name: "Pechay", price: 25.5 }, "c");
    expect(cartCount(items)).toBe(3);
    expect(cartTotal(items)).toBe(665.5);
  });

  it("warns at the threshold and says how much you're over", () => {
    expect(budgetStatus(1000, 2000).tone).toBe("ok");
    expect(budgetStatus(1700, 2000)).toMatchObject({ tone: "careful", mood: "worried", pct: 85 });
    expect(budgetStatus(2150, 2000)).toMatchObject({
      tone: "over",
      mood: "shocked",
      message: "Over by ₱150. Remove something?",
    });
  });

  it("tells you when THAT item pushes you over", () => {
    expect(scanNote(1900, 200, 2000)).toBe("this item puts you over by ₱100");
    expect(scanNote(2100, 50, 2000)).toBe("now over by ₱150");
    expect(scanNote(1000, 200, 2000)).toBe("₱800 left");
  });

  it("remembers prices per store, falling back to the last one seen", () => {
    const memory = { "480": { name: "Rice 5 kg", prices: { Puregold: 310 }, last: 325 } };
    expect(rememberedPrice(memory, "480", "Puregold")).toEqual({
      name: "Rice 5 kg",
      price: 310,
      atThisStore: true,
    });
    expect(rememberedPrice(memory, "480", "SM")).toEqual({
      name: "Rice 5 kg",
      price: 325,
      atThisStore: false,
    });
    expect(rememberedPrice(memory, "999", "SM")).toBeNull();
  });

  it("explains a receipt that doesn't match", () => {
    expect(receiptNote(1000, 1000)).toMatch(/Matches/);
    expect(receiptNote(1000, 1040)).toMatch(/₱40 higher/);
    expect(receiptNote(1000, 950)).toMatch(/₱50 lower/);
  });
});

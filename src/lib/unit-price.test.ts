import { describe, expect, it } from "vitest";
import { cartLine, compareRows, rowLabel, unitPrice, type CompareRow } from "./unit-price";

const row = (over: Partial<CompareRow>): CompareRow => ({
  name: "",
  size: "",
  unit: "ml",
  count: "1",
  price: "",
  ...over,
});

const lotionA = row({ name: "Lotion A", size: "500", count: "2", price: "599" });
const lotionB = row({ name: "Lotion B", size: "900", price: "580" });

describe("compare prices", () => {
  it("finds the better deal in the lotion example", () => {
    const [a, b] = compareRows([lotionA, lotionB]);
    expect(a).toMatchObject({ status: "ok", best: true, pctMore: 0, displayLabel: "100 ml" });
    expect(a.status === "ok" && a.perDisplay).toBeCloseTo(59.9, 5);
    expect(b).toMatchObject({ status: "ok", best: false, pctMore: 7.6 });
    expect(b.status === "ok" && b.perDisplay).toBeCloseTo(64.444, 3);
  });

  it("converts L to ml and kg to g", () => {
    expect(unitPrice(row({ size: "1", unit: "L", price: "100" }))).toBeCloseTo(0.1);
    expect(unitPrice(row({ size: "1000", unit: "ml", price: "100" }))).toBeCloseTo(0.1);
    const [kg, g] = compareRows([
      row({ size: "1", unit: "kg", price: "200" }),
      row({ size: "500", unit: "g", price: "90" }),
    ]);
    expect(g).toMatchObject({ best: true });
    expect(kg).toMatchObject({ best: false, pctMore: 11.1, displayLabel: "100 g" });
  });

  it("keeps fl oz as volume and oz as weight", () => {
    const [ml, floz, oz] = compareRows([
      row({ size: "100", price: "50" }),
      row({ size: "8", unit: "fl oz", price: "100" }),
      row({ size: "8", unit: "oz", price: "100" }),
    ]);
    expect(ml.status).toBe("ok");
    expect(floz.status).toBe("ok");
    expect(oz).toEqual({ status: "incomparable", message: "Can't compare oz with ml" });
  });

  it("gives a tie the badge on both", () => {
    const results = compareRows([
      row({ size: "1", unit: "dozen", price: "120" }),
      row({ size: "6", unit: "pcs", price: "60" }),
    ]);
    expect(results.map((r) => r.status === "ok" && r.best)).toEqual([true, true]);
    expect(results[0]).toMatchObject({ displayLabel: "pc", perDisplay: 10 });
  });

  it("shows no badge with only one product filled in", () => {
    const [one, blank] = compareRows([lotionA, row({ size: "900" })]);
    expect(one).toMatchObject({ status: "ok", best: false, pctMore: 0 });
    expect(blank).toEqual({ status: "blank" });
  });

  it("ignores blank, zero and bad values", () => {
    expect(unitPrice(row({ size: "0", price: "10" }))).toBeNull();
    expect(unitPrice(row({ size: "", price: "10" }))).toBeNull();
    expect(unitPrice(row({ size: "abc", price: "10" }))).toBeNull();
    expect(unitPrice(row({ size: "10", price: "0" }))).toBeNull();
    expect(unitPrice(row({ size: "10", count: "1.5", price: "10" }))).toBeNull();
    expect(unitPrice(row({ size: "10", count: "", price: "10" }))).toBeCloseTo(1);
    expect(unitPrice(row({ size: "1,000", price: "₱1,000" }))).toBeCloseTo(1);
    expect(compareRows([])).toEqual([]);
  });

  it("ranks by the first filled kind and shows length per m", () => {
    const [w, m1, m2] = compareRows([
      row({ size: "1", unit: "kg" }),
      row({ size: "30", unit: "m", price: "150" }),
      row({ size: "500", unit: "cm", price: "20" }),
    ]);
    expect(w).toEqual({ status: "blank" });
    expect(m1).toMatchObject({ displayLabel: "m", perDisplay: 5, pctMore: 25 });
    expect(m2).toMatchObject({ best: true, perDisplay: 4 });
  });

  it("names the grocery cart line", () => {
    expect(cartLine(lotionA, 0)).toEqual({ name: "Lotion A 500 ml ×2", price: 599, barcode: null });
    expect(cartLine({ ...lotionB, name: " " }, 1)).toEqual({
      name: "Product 2 900 ml",
      price: 580,
      barcode: null,
    });
    expect(cartLine(row({}), 0)).toBeNull();
    expect(rowLabel(row({ name: "Soap" }), 3)).toBe("Soap");
  });
});

import { describe, expect, it } from "vitest";
import { categoryTrends, periodAfter, periodBefore, readSpan, trendPeriods } from "@/lib/trend";

type T = Parameters<typeof categoryTrends>[0][number];

const txn = (
  occurredOn: string,
  amount: number,
  category: string,
  subcategory: string | null = null,
  type: T["type"] = "expense",
): T => ({
  type,
  amount,
  category,
  subcategory,
  occurredOn,
});

describe("periods", () => {
  it("reads the span, kinsenas unless it's month", () => {
    expect(readSpan("month")).toBe("month");
    expect(readSpan(undefined)).toBe("kinsenas");
    expect(readSpan("year")).toBe("kinsenas");
  });

  it("lists the last kinsenas, oldest first, ending with the one the day is in", () => {
    expect(trendPeriods("kinsenas", "2026-11-23", 4)).toEqual([
      { start: "2026-10-01", end: "2026-10-15" },
      { start: "2026-10-16", end: "2026-10-31" },
      { start: "2026-11-01", end: "2026-11-15" },
      { start: "2026-11-16", end: "2026-11-30" },
    ]);
  });

  it("lists months across February and the year end", () => {
    expect(trendPeriods("month", "2027-03-10", 4)).toEqual([
      { start: "2026-12-01", end: "2026-12-31" },
      { start: "2027-01-01", end: "2027-01-31" },
      { start: "2027-02-01", end: "2027-02-28" },
      { start: "2027-03-01", end: "2027-03-31" },
    ]);
  });

  it("steps one period back and forward", () => {
    const feb = { start: "2028-02-16", end: "2028-02-29" };
    expect(periodBefore("kinsenas", feb)).toEqual({ start: "2028-02-01", end: "2028-02-15" });
    expect(periodAfter("kinsenas", feb)).toEqual({ start: "2028-03-01", end: "2028-03-15" });
    expect(periodBefore("month", { start: "2027-01-01", end: "2027-01-31" })).toEqual({
      start: "2026-12-01",
      end: "2026-12-31",
    });
  });
});

describe("categoryTrends", () => {
  const periods = trendPeriods("kinsenas", "2026-11-20", 3);

  it("adds up each period and compares the last with the one before", () => {
    const [transpo] = categoryTrends(
      [
        txn("2026-11-18", 100, "transport"),
        txn("2026-11-16", 50, "transport"),
        txn("2026-11-05", 120, "transport"),
        txn("2026-10-20", 80, "transport"),
      ],
      periods,
    );
    expect(transpo).toMatchObject({
      key: "transport",
      totals: [80, 120, 150],
      current: 150,
      previous: 120,
      change: 30,
      percent: 25,
    });
  });

  it("has no percent when nothing was spent the period before", () => {
    const [load] = categoryTrends([txn("2026-11-17", 300, "load")], periods);
    expect(load).toMatchObject({ totals: [0, 0, 300], change: 300, percent: null });
  });

  it("leaves out income, transfers, adjustments and days outside the periods", () => {
    const trends = categoryTrends(
      [
        txn("2026-11-17", 500, "salary", null, "income"),
        txn("2026-11-17", 200, "transport", null, "transfer"),
        txn("2026-11-17", 40, "adjustment"),
        txn("2026-09-30", 999, "food"),
        txn("2026-11-17", 60, "food"),
      ],
      periods,
    );
    expect(trends.map((t) => t.key)).toEqual(["food"]);
    expect(trends[0].totals).toEqual([0, 0, 60]);
  });

  it("merges subcategories however they're capitalised, spelled the newest way", () => {
    const [transpo] = categoryTrends(
      [
        txn("2026-11-18", 40, "transport", "Jeep"),
        txn("2026-11-02", 30, "transport", " jeep "),
        txn("2026-11-01", 25, "transport", null),
      ],
      periods,
    );
    expect(transpo.subs).toEqual([
      expect.objectContaining({ name: "Jeep", totals: [0, 30, 40], change: 10 }),
      expect.objectContaining({ name: null, totals: [0, 25, 0], change: -25 }),
    ]);
  });

  it("puts the biggest increase first and nothing spent now last", () => {
    const trends = categoryTrends(
      [
        txn("2026-11-17", 100, "food"),
        txn("2026-11-03", 300, "food"),
        txn("2026-11-17", 200, "load"),
        txn("2026-11-17", 150, "transport"),
        txn("2026-11-03", 100, "transport"),
        txn("2026-11-03", 500, "shopping"),
      ],
      periods,
    );
    expect(trends.map((t) => [t.key, t.change])).toEqual([
      ["load", 200],
      ["transport", 50],
      ["food", -200],
      ["shopping", -500],
    ]);
  });

  it("rounds to centavos", () => {
    const [food] = categoryTrends(
      [txn("2026-11-17", 0.1, "food"), txn("2026-11-17", 0.2, "food")],
      periods,
    );
    expect(food.current).toBe(0.3);
  });
});

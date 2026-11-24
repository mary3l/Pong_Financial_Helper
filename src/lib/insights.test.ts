import { describe, expect, it } from "vitest";
import {
  budgetPace,
  elapsedShare,
  frequentBuys,
  goalProgress,
  paydayEffect,
  suggestions,
  summarize,
  tidy,
  usualOf,
  weekendSplit,
  type Goal,
  type SpendTxn,
} from "@/lib/insights";
import { categoryTrends, trendPeriods } from "@/lib/trend";

const txn = (
  occurredOn: string,
  amount: number,
  category: string,
  subcategory: string | null = null,
  type: SpendTxn["type"] = "expense",
): SpendTxn => ({ type, amount, category, subcategory, occurredOn });

describe("helpers", () => {
  it("rounds up to tidy amounts", () => {
    expect(tidy(123)).toBe(130);
    expect(tidy(1201)).toBe(1250);
    expect(tidy(1500)).toBe(1500);
  });

  it("says how much of a period has gone by", () => {
    const nov = { start: "2026-11-16", end: "2026-11-30" };
    expect(elapsedShare(nov, "2026-11-10")).toBe(0);
    expect(elapsedShare(nov, "2026-11-16")).toBeCloseTo(1 / 15);
    expect(elapsedShare(nov, "2026-11-30")).toBe(1);
    expect(elapsedShare(nov, "2026-12-02")).toBe(1);
  });

  it("averages the periods before the last, from the first with spending", () => {
    expect(usualOf([0, 0, 100, 300, 999])).toBe(200);
    // One period isn't enough to call usual.
    expect(usualOf([0, 0, 0, 100, 999])).toBeNull();
    expect(usualOf([0, 0, 0])).toBeNull();
  });
});

describe("summarize", () => {
  const periods = trendPeriods("kinsenas", "2026-11-20", 4);
  // Oct 1, Oct 16, Nov 1, Nov 16 (the one we're looking at).
  const history = [
    txn("2026-10-02", 400, "food"),
    txn("2026-10-17", 400, "food"),
    txn("2026-11-02", 400, "food"),
    txn("2026-10-03", 200, "transport", "Jeep"),
    txn("2026-10-18", 200, "transport", "Jeep"),
    txn("2026-11-03", 200, "transport", "Jeep"),
  ];

  it("compares the period with your usual and names what drove it", () => {
    const trends = categoryTrends(
      [
        ...history,
        txn("2026-11-17", 300, "food"),
        txn("2026-11-18", 900, "transport", "Grab"),
        txn("2026-11-19", 100, "transport", "Jeep"),
      ],
      periods,
    );
    const s = summarize(trends, 1);
    expect(s).toMatchObject({ spent: 1300, usual: 600, diff: 700 });
    expect(s.ups).toEqual([{ key: "transport", sub: "Grab", diff: 800 }]);
    expect(s.down).toEqual({ key: "food", sub: null, diff: -100 });
    expect(s.unusual).toEqual(["transport"]);
    expect(s.top.keys).toEqual(["transport", "food"]);
    expect(s.top.share).toBe(1);
  });

  it("pro-rates your usual partway through, and holds back flags early on", () => {
    const trends = categoryTrends([...history, txn("2026-11-16", 500, "transport")], periods);
    const early = summarize(trends, 0.2);
    expect(early.usual).toBe(120);
    expect(early.diff).toBe(380);
    expect(early.unusual).toEqual([]);
  });

  it("has no usual without history", () => {
    const s = summarize(categoryTrends([txn("2026-11-17", 50, "food")], periods), 1);
    expect(s).toMatchObject({ spent: 50, usual: null, diff: null });
  });
});

describe("habits", () => {
  it("measures how much goes in the days right after payday", () => {
    const txns = [
      txn("2026-11-15", 600, "food"), // payday
      txn("2026-11-16", 300, "shopping"),
      txn("2026-11-20", 100, "food"),
      txn("2026-11-01", 200, "fun"), // payday
      txn("2026-11-01", 5000, "salary", null, "income"),
    ];
    const effect = paydayEffect(txns, ["2026-11-01", "2026-11-15"], "2026-11-01", "2026-11-30");
    expect(effect).toEqual({ spendShare: 1100 / 1200, dayShare: 6 / 30, paydays: 2 });
    // One payday isn't a pattern.
    expect(paydayEffect(txns, ["2026-11-15"], "2026-11-01", "2026-11-30")).toBeNull();
  });

  it("compares an average weekend day with a weekday", () => {
    // Nov 21–22, 2026 is a Saturday and Sunday; Nov 16–22 is one week.
    const txns = [
      txn("2026-11-21", 400, "fun"),
      txn("2026-11-22", 200, "food"),
      txn("2026-11-17", 500, "food"),
    ];
    expect(weekendSplit(txns, "2026-11-16", "2026-11-22")).toEqual({
      weekendPerDay: 300,
      weekdayPerDay: 100,
    });
    expect(weekendSplit([], "2026-11-16", "2026-11-22")).toBeNull();
  });

  it("finds small buys you make often, merging spellings", () => {
    const txns = [
      ...Array.from({ length: 6 }, (_, i) =>
        txn(`2026-11-${10 + i}`, 140, "food", i ? "milk tea" : "Milk tea"),
      ),
      ...Array.from({ length: 6 }, (_, i) => txn(`2026-11-${10 + i}`, 900, "shopping")),
      ...Array.from({ length: 5 }, (_, i) => txn(`2026-11-${10 + i}`, 50, "transport", "Jeep")),
    ];
    expect(frequentBuys(txns, "2026-11-01", "2026-11-30")).toEqual([
      { key: "food", sub: "Milk tea", count: 6, average: 140, total: 840 },
    ]);
  });
});

describe("suggestions", () => {
  const periods = trendPeriods("kinsenas", "2026-11-20", 4);

  it("suggests fewer of a frequent buy, getting back to usual, and a budget", () => {
    const txns = [
      txn("2026-10-02", 800, "food"),
      txn("2026-10-17", 800, "food"),
      txn("2026-11-02", 800, "food"),
      txn("2026-10-03", 300, "transport", "Grab"),
      txn("2026-10-18", 300, "transport", "Grab"),
      txn("2026-11-03", 300, "transport", "Grab"),
      txn("2026-11-17", 1000, "transport", "Grab"),
      txn("2026-11-18", 800, "food"),
    ];
    const trends = categoryTrends(txns, periods);
    const summary = summarize(trends, 1);
    const milkTea = { key: "food", sub: "Milk tea", count: 12, average: 140, total: 1680 };
    const out = suggestions({
      trends,
      summary,
      frequent: [milkTea],
      windowDays: 28,
      budgeted: new Set(["transport"]),
      kinsenasUsual: new Map([
        ["food", 800],
        ["transport", 300],
      ]),
    });
    expect(out).toEqual([
      // 2 fewer a week × ₱140 × 4.35 weeks ≈ ₱1,218 → ₱1,250.
      expect.objectContaining({
        kind: "fewer",
        key: "food",
        sub: "Milk tea",
        perWeek: 3,
        saves: 1250,
      }),
      expect.objectContaining({
        kind: "usual",
        key: "transport",
        sub: "Grab",
        over: 700,
        usual: 300,
      }),
      { kind: "budget", key: "food", usual: 800, amount: 800 },
    ]);
    expect(out[1]).toMatchObject({ goal: { category: "transport", sub: "Grab", limit: 300 } });
  });

  it("skips buys too rare to cut back on, and budgets for small categories", () => {
    const trends = categoryTrends([], periods);
    const out = suggestions({
      trends,
      summary: summarize(trends, 1),
      frequent: [{ key: "food", sub: null, count: 6, average: 100, total: 600 }],
      windowDays: 30,
      budgeted: new Set(),
      kinsenasUsual: new Map([["fun", 300]]),
    });
    expect(out).toEqual([]);
  });
});

describe("budgetPace", () => {
  const trends = categoryTrends(
    [txn("2026-11-17", 900, "food"), txn("2026-11-17", 3000, "fun")],
    trendPeriods("kinsenas", "2026-11-20", 2),
  );
  const budgets = [
    { category: "food", amount: 2000 },
    { category: "fun", amount: 2500 },
    { category: "transport", amount: 1000 },
  ];

  it("shows each budget ahead of, on or over its pace", () => {
    expect(budgetPace(budgets, trends, "kinsenas", 0.4)).toEqual([
      { key: "fun", limit: 2500, spent: 3000, expected: 1000, status: "over" },
      { key: "food", limit: 2000, spent: 900, expected: 800, status: "ahead" },
      { key: "transport", limit: 1000, spent: 0, expected: 400, status: "on_pace" },
    ]);
  });

  it("doubles budgets for a month", () => {
    expect(budgetPace(budgets, trends, "month", 1)[1]).toMatchObject({ key: "food", limit: 4000 });
  });
});

describe("goalProgress", () => {
  const goal: Goal = {
    id: "g1",
    category: "transport",
    subcategory: "Grab",
    limit: 1000,
    startsOn: "2026-11-16",
    endsOn: "2026-11-25",
  };
  const txns = [
    txn("2026-11-17", 300, "transport", "grab"),
    txn("2026-11-18", 999, "transport", "Jeep"),
    txn("2026-11-15", 999, "transport", "Grab"),
    txn("2026-11-26", 999, "transport", "Grab"),
  ];

  it("counts only its subcategory between its dates", () => {
    // Day 5 of 10, ₱300 of ₱1,000: on track, ₱700 over 6 days left.
    expect(goalProgress(goal, txns, "2026-11-20")).toEqual({
      spent: 300,
      status: "on_track",
      daysLeft: 6,
      perDayLeft: 116.67,
    });
  });

  it("is at risk when ahead of an even pace, and over past the limit", () => {
    expect(goalProgress(goal, txns, "2026-11-17").status).toBe("at_risk");
    expect(goalProgress({ ...goal, limit: 200 }, txns, "2026-11-20")).toMatchObject({
      status: "over",
      perDayLeft: 0,
    });
  });

  it("is met or missed once it's over", () => {
    expect(goalProgress(goal, txns, "2026-11-26")).toMatchObject({ status: "met", daysLeft: 0 });
    expect(goalProgress({ ...goal, limit: 100 }, txns, "2026-11-26").status).toBe("missed");
  });

  it("counts the whole category when it has no subcategory", () => {
    expect(goalProgress({ ...goal, subcategory: null }, txns, "2026-11-20").spent).toBe(1299);
  });
});

import { describe, expect, it } from "vitest";
import { goalPlan, isGoTyme, projectBalance } from "@/lib/goals";

// ₱100,000 at 3.65% a year: ₱8 a day after tax.
const goTyme = { balance: 100_000, ratePerYear: 3.65, payout: "monthly" as const };

describe("GoTyme GoalSave interest", () => {
  it("adds the month's interest on the 1st, after tax", () => {
    // Nov 5 to Nov 30: 26 days at ₱8, credited Dec 1.
    expect(projectBalance({ ...goTyme, from: "2026-11-05", to: "2026-12-01" })).toEqual({
      balance: 100_208,
      interest: 208,
      deposits: 0,
    });
  });

  it("doesn't count interest that isn't credited by the deadline", () => {
    expect(projectBalance({ ...goTyme, from: "2026-11-05", to: "2026-11-30" }).balance).toBe(
      100_000,
    );
  });

  it("credits what built up before today on the next 1st", () => {
    expect(
      projectBalance({ ...goTyme, pending: 32, from: "2026-11-29", to: "2026-12-01" }).interest,
    ).toBe(48);
  });

  it("earns on interest once it's credited", () => {
    const year = projectBalance({ ...goTyme, from: "2026-01-01", to: "2027-01-01" });
    // 365 days at ₱8 is ₱2,920; compounding monthly adds a little.
    expect(year.interest).toBeGreaterThan(2920);
    expect(year.interest).toBeLessThan(2960);
  });

  it("adds MariBank's interest every day", () => {
    const mari = projectBalance({
      ...goTyme,
      payout: "daily",
      from: "2026-11-05",
      to: "2026-11-30",
    });
    expect(mari.balance).toBeGreaterThan(100_208);
  });

  it("puts deposits in from today, monthly on the same day", () => {
    const plan = { balance: 0, ratePerYear: null, payout: "monthly" as const, deposit: 1000 };
    expect(projectBalance({ ...plan, from: "2026-11-05", to: "2027-10-05" }).deposits).toBe(12);
    expect(projectBalance({ ...plan, from: "2026-11-05", to: "2027-10-04" }).deposits).toBe(11);
    // The 31st moves to the end of shorter months.
    expect(projectBalance({ ...plan, from: "2027-01-31", to: "2027-03-01" }).deposits).toBe(2);
    expect(
      projectBalance({ ...plan, every: "weekly", from: "2026-11-05", to: "2026-11-19" }).deposits,
    ).toBe(3);
  });
});

describe("goals", () => {
  const wallet = { balance: 0, interestRate: null, interestPayout: "monthly" as const };

  it("splits what's left into deposits, starting today", () => {
    const plan = goalPlan(wallet, { amount: 12_000, date: "2027-10-05" }, "2026-11-05");
    expect(plan.needed?.monthly).toEqual({ amount: 1000, deposits: 12, interest: 0 });
    expect(plan.needed?.daily.deposits).toBe(335);
    expect(plan.needed?.daily.amount).toBe(36); // ₱12,000 ÷ 335, rounded up
  });

  it("needs less when GoTyme's interest helps", () => {
    const plan = goalPlan(
      { ...wallet, interestRate: 3 },
      { amount: 12_000, date: "2027-10-05" },
      "2026-11-05",
    );
    expect(plan.needed!.monthly.amount).toBeLessThan(1000);
    expect(plan.needed!.monthly.interest).toBeGreaterThan(0);
  });

  it("knows when interest alone gets there", () => {
    const plan = goalPlan(
      { balance: 100_000, interestRate: 3.65, interestPayout: "monthly" },
      { amount: 100_200, date: "2026-12-01" },
      "2026-11-05",
    );
    expect(plan.needed).toBeNull();
    expect(plan.interestOnly?.balance).toBe(100_208);
  });

  it("counts interest the bank added but isn't logged yet", () => {
    const accrued = {
      perDay: 8,
      since: "2026-11-01",
      days: 4,
      amount: 32,
      credited: { on: "2026-11-01", from: "2026-10-15", amount: 136 },
      nextPayout: "2026-12-01",
    };
    const plan = goalPlan(
      { balance: 100_000, interestRate: 3.65, interestPayout: "monthly" },
      { amount: 200_000, date: "2026-12-01" },
      "2026-11-05",
      accrued,
    );
    expect(plan.saved).toBe(100_000);
    // ₱136 credited, plus ₱32 + ₱208 on Dec 1, plus ₱0.28 the ₱136 earns.
    expect(plan.interestOnly?.balance).toBe(100_376.28);
  });

  it("shows progress without a deadline, and stops planning once reached or late", () => {
    expect(
      goalPlan({ ...wallet, balance: 2500 }, { amount: 10_000, date: null }, "2026-11-05"),
    ).toMatchObject({
      progress: 0.25,
      left: 7500,
      needed: null,
    });
    expect(
      goalPlan(
        { ...wallet, balance: 12_000 },
        { amount: 10_000, date: "2027-01-01" },
        "2026-11-05",
      ),
    ).toMatchObject({
      reached: true,
      progress: 1,
      needed: null,
    });
    expect(goalPlan(wallet, { amount: 10_000, date: "2026-11-01" }, "2026-11-05")).toMatchObject({
      daysLeft: -4,
      needed: null,
    });
  });
});

it("spots GoTyme wallets", () => {
  expect(isGoTyme("GoTyme Long Term")).toBe(true);
  expect(isGoTyme("Go Tyme")).toBe(true);
  expect(isGoTyme("MariBank")).toBe(false);
});

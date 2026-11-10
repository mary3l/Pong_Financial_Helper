import { describe, expect, it } from "vitest";
import {
  affordVerdict,
  isOwed,
  itemEffect,
  project,
  safeToSpend,
  scheduledItems,
  splitAmount,
  type ScheduleInputs,
} from "@/lib/forecast";

const TODAY = "2026-11-02";

const payday = {
  id: "pay",
  kind: "payday" as const,
  name: "Payday",
  amount: 15000,
  amountVaries: false,
  accountId: "bank",
  category: null,
  frequency: "twice_monthly" as const,
  day1: 15,
  day2: 30,
  endsOn: null,
};

const rent = {
  ...payday,
  id: "rent",
  kind: "bill" as const,
  name: "Rent",
  amount: 6000,
  frequency: "monthly" as const,
  day1: 5,
  day2: null,
};

const allowance = {
  ...payday,
  id: "allowance",
  kind: "income" as const,
  name: "Allowance",
  amount: 2000,
  frequency: "weekly" as const,
  day1: 1, // Mondays
  day2: null,
  endsOn: "2026-11-20",
};

function inputs(extra: Partial<ScheduleInputs> = {}): ScheduleInputs {
  return { recurring: [payday, rent, allowance], billPayments: [], planned: [], ...extra };
}

describe("scheduled items", () => {
  const items = scheduledItems(inputs(), TODAY, "2026-12-02");

  it("includes paydays, bills and recurring income in date order, starting today", () => {
    // Nov 2, 2026 is a Monday, so the allowance lands today too.
    expect(items.map((i) => `${i.dueOn} ${i.name}`)).toEqual([
      "2026-11-02 Allowance",
      "2026-11-05 Rent",
      "2026-11-09 Allowance",
      "2026-11-15 Payday",
      "2026-11-16 Allowance",
      "2026-11-30 Payday",
    ]);
  });

  it("gives each payday its own amount from the payroll calculator", () => {
    const withPayroll = scheduledItems(
      inputs({ paydayAmounts: { "2026-11-15": { amount: 8000, estimate: false }, "2026-11-30": { amount: 8800, estimate: true } } }),
      TODAY,
      "2026-12-02",
    ).filter((i) => i.kind === "payday");
    expect(withPayroll.map((i) => [i.dueOn, i.amount, i.estimate])).toEqual([
      ["2026-11-15", 8000, false],
      ["2026-11-30", 8800, true],
    ]);
  });

  it("stops recurring items after their end date", () => {
    expect(items.filter((i) => i.id === "allowance").at(-1)!.dueOn).toBe("2026-11-16");
  });

  it("income counts +, expenses −, and logged items count 0", () => {
    const logged = scheduledItems(
      inputs({ billPayments: [{ recurringItemId: "rent", dueOn: "2026-11-05", transactionId: "t1" }] }),
      TODAY,
      "2026-12-02",
    );
    const rentItem = logged.find((i) => i.id === "rent")!;
    expect(itemEffect(rentItem)).toBe(0);
    expect(isOwed(rentItem)).toBe(false);
    expect(itemEffect(logged.find((i) => i.kind === "payday")!)).toBe(15000);
    expect(itemEffect(items.find((i) => i.id === "rent")!)).toBe(-6000);
  });

  it("keeps unlogged planned items from before today, and planned income flows in", () => {
    const withPlanned = scheduledItems(
      inputs({
        planned: [
          { id: "late", type: "expense", name: "Tuition", amount: 5000, category: "family", dueOn: "2026-10-30", accountId: null, transactionId: null },
          { id: "bonus", type: "income", name: "13th month", amount: 20000, category: "salary", dueOn: "2026-11-20", accountId: null, transactionId: null },
        ],
      }),
      TODAY,
      "2026-12-02",
    );
    expect(withPlanned.find((i) => i.id === "late")).toBeDefined();
    expect(itemEffect(withPlanned.find((i) => i.id === "bonus")!)).toBe(20000);
  });

  it("unpaid installments are owed, late ones included", () => {
    const withInstallments = scheduledItems(
      inputs({
        installments: [
          { id: "i1", name: "Shoes (1 of 3)", dueOn: "2026-10-25", amount: 1045, payFromAccountId: "gcash", transactionId: null },
          { id: "i2", name: "Shoes (2 of 3)", dueOn: "2026-11-25", amount: 1045, payFromAccountId: "gcash", transactionId: null },
        ],
      }),
      TODAY,
      "2026-12-02",
    );
    const installments = withInstallments.filter((i) => i.kind === "installment");
    expect(installments).toHaveLength(2);
    expect(installments.every(isOwed)).toBe(true);
  });
});

describe("safe to spend", () => {
  it("is wallet money minus what's due before payday, per day", () => {
    const items = scheduledItems(inputs(), TODAY, "2026-12-02");
    const sts = safeToSpend({ inWallets: 10000, payday, items, today: TODAY });
    expect(sts.nextPayday).toBe("2026-11-15");
    expect(sts.daysLeft).toBe(13);
    expect(sts.dueBeforePayday).toBe(6000); // rent; the allowance doesn't count
    expect(sts.free).toBe(4000);
    expect(sts.perDay).toBe(Math.floor(4000 / 13));
  });

  it("takes today's spending out of today's share without shrinking it", () => {
    const items = scheduledItems(inputs(), TODAY, "2026-12-02");
    // 300 already spent today: the wallets started the day at 10,000.
    const sts = safeToSpend({ inWallets: 9700, payday, items, today: TODAY, spentToday: 300 });
    expect(sts.perDay).toBe(Math.floor(4000 / 13));
    expect(sts.spentToday).toBe(300);
    expect(sts.leftToday).toBe(Math.floor(4000 / 13) - 300);
  });

  it("goes below 0 for today when you spend more than today's share", () => {
    const items = scheduledItems(inputs(), TODAY, "2026-12-02");
    const sts = safeToSpend({ inWallets: 9000, payday, items, today: TODAY, spentToday: 1000 });
    expect(sts.leftToday).toBe(Math.floor(4000 / 13) - 1000);
  });

  it("never goes below 0", () => {
    const items = scheduledItems(inputs(), TODAY, "2026-12-02");
    expect(safeToSpend({ inWallets: 1000, payday, items, today: TODAY }).perDay).toBe(0);
  });

  it("without a payday is just what's in your wallets", () => {
    expect(safeToSpend({ inWallets: 500, payday: null, items: [], today: TODAY }).free).toBe(500);
  });
});

describe("projection and can I afford this", () => {
  it("finds the low point", () => {
    const items = scheduledItems(inputs(), TODAY, "2026-12-02");
    const p = project(7000, items, TODAY, 30);
    // 7,000 + 2,000 allowance today − 6,000 rent on the 5th.
    expect(p.lowest).toEqual({ date: "2026-11-05", balance: 3000 });
  });

  it("says no when a purchase takes you below 0, and wait when payday fixes it", () => {
    const items = scheduledItems(inputs(), TODAY, "2026-12-02");
    const no = affordVerdict({ start: 7000, items, purchase: { name: "Phone", amount: 30000, first: TODAY, months: 1 }, today: TODAY, nextPayday: "2026-11-15" });
    expect(no.tone).toBe("no");
    const wait = affordVerdict({ start: 7000, items, purchase: { name: "Shoes", amount: 4000, first: TODAY, months: 1 }, today: TODAY, nextPayday: "2026-11-15" });
    expect(wait.tone).toBe("wait");
  });

  it("splits an amount so the payments add back up exactly", () => {
    const parts = splitAmount(1000, 3);
    expect(parts).toEqual([333.33, 333.33, 333.34]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 10);
  });
});

describe("safe to spend with weekly pay", () => {
  // Paid ₱3,000 every Friday; rent ₱6,000 on the 20th. Nov 2, 2026 is a Monday.
  const weekly = { ...payday, amount: 3000, frequency: "weekly" as const, day1: 5, day2: null };
  const bigRent = { ...rent, amount: 6000, day1: 20 };
  const items = scheduledItems({ recurring: [weekly, bigRent], billPayments: [], planned: [] }, TODAY, "2026-12-02");

  it("holds money back for a bill the next pays can't cover", () => {
    const sts = safeToSpend({ inWallets: 4000, payday: weekly, items, today: TODAY });
    expect(sts.nextPayday).toBe("2026-11-06");
    expect(sts.daysLeft).toBe(4);
    // Without looking ahead it would be 4,000 ÷ 4 = 1,000 a day. The tightest
    // day is Nov 26, the eve of the 4th pay: 4,000 + 3 pays − 6,000 rent =
    // 7,000 for 25 days, so ₱280 a day.
    expect(sts.perDay).toBe(280);
    expect(sts.setAsideLater).toBe(4000 - 280 * 4);
    expect(sts.free).toBe(280 * 4);
  });

  it("holds nothing back when the pays cover the bills", () => {
    const sts = safeToSpend({ inWallets: 4000, payday: { ...weekly }, items: scheduledItems({ recurring: [{ ...weekly, amount: 20000 }, bigRent], billPayments: [], planned: [] }, TODAY, "2026-12-02"), today: TODAY });
    expect(sts.setAsideLater).toBe(0);
    expect(sts.perDay).toBe(1000);
  });

  it("never counts pay toward what you can spend before it comes in", () => {
    const rich = scheduledItems({ recurring: [{ ...weekly, amount: 100000 }], billPayments: [], planned: [] }, TODAY, "2026-12-02");
    expect(safeToSpend({ inWallets: 400, payday: weekly, items: rich, today: TODAY }).perDay).toBe(100);
  });

  it("leaves pay twice a month as it was", () => {
    const sts = safeToSpend({ inWallets: 10000, payday, items: scheduledItems(inputs(), TODAY, "2026-12-02"), today: TODAY });
    expect(sts.setAsideLater).toBe(0);
  });
});

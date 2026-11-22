import { describe, expect, it } from "vitest";
import {
  isOwed,
  itemEffect,
  nextUnreceivedPayday,
  project,
  scheduledItems,
  splitAmount,
  type ScheduleInputs,
} from "@/lib/forecast";
import { affordVerdict } from "@/lib/payment-plan";

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
      inputs({
        paydayAmounts: {
          "2026-11-15": { amount: 8000, estimate: false },
          "2026-11-30": { amount: 8800, estimate: true },
        },
      }),
      TODAY,
      "2026-12-02",
    ).filter((i) => i.kind === "payday");
    expect(withPayroll.map((i) => [i.dueOn, i.amount, i.estimate])).toEqual([
      ["2026-11-15", 8000, false],
      ["2026-11-30", 8800, true],
    ]);
  });

  it("carries a payday's gross and your office's contributions", () => {
    const [pay] = scheduledItems(
      inputs({
        paydayAmounts: {
          "2026-11-30": {
            amount: 6200,
            estimate: true,
            gross: 8000,
            deductions: [{ name: "GSIS", amount: 1800, kind: "gsis" }],
          },
        },
      }),
      TODAY,
      "2026-12-02",
    ).filter((i) => i.kind === "payday" && i.dueOn === "2026-11-30");
    expect(pay.amount).toBe(6200);
    // Its kind too, so the payday can list it under Contributions.
    expect(pay.pay).toEqual({
      gross: 8000,
      deductions: [{ name: "GSIS", amount: 1800, kind: "gsis" }],
    });
    // Not a bill: nothing else is added.
    expect(itemEffect(pay)).toBe(6200);
  });

  it("stops recurring items after their end date", () => {
    expect(items.filter((i) => i.id === "allowance").at(-1)!.dueOn).toBe("2026-11-16");
  });

  it("income counts +, expenses −, and logged items count 0", () => {
    const logged = scheduledItems(
      inputs({
        billPayments: [{ recurringItemId: "rent", dueOn: "2026-11-05", transactionId: "t1" }],
      }),
      TODAY,
      "2026-12-02",
    );
    const rentItem = logged.find((i) => i.id === "rent")!;
    expect(itemEffect(rentItem)).toBe(0);
    expect(isOwed(rentItem)).toBe(false);
    expect(itemEffect(logged.find((i) => i.kind === "payday")!)).toBe(15000);
    expect(itemEffect(items.find((i) => i.id === "rent")!)).toBe(-6000);
  });

  describe("bills you haven't paid yet", () => {
    // Rent was due Oct 5; it's Nov 2 and it isn't marked paid.
    const added = { ...rent, startsOn: "2026-09-01" };

    it("stay owed after their date, and count today", () => {
      const late = scheduledItems({ ...inputs(), recurring: [payday, added] }, TODAY, "2026-12-02");
      const owed = late.filter((i) => i.id === "rent");
      expect(owed.map((i) => i.dueOn)).toEqual(["2026-10-05", "2026-11-05"]);
      expect(itemEffect(owed[0])).toBe(-6000);
      expect(project(10000, late, TODAY, 3).days[0].balance).toBe(4000);
    });

    it("drop out once paid", () => {
      const paid = scheduledItems(
        {
          ...inputs(),
          recurring: [payday, added],
          billPayments: [{ recurringItemId: "rent", dueOn: "2026-10-05", transactionId: "t1" }],
        },
        TODAY,
        "2026-12-02",
      );
      expect(paid.filter((i) => i.id === "rent").map((i) => i.dueOn)).toEqual(["2026-11-05"]);
    });

    it("never from before the bill was added, or more than a month back", () => {
      const fresh = scheduledItems(
        { ...inputs(), recurring: [{ ...rent, startsOn: "2026-10-20" }] },
        TODAY,
        "2026-12-02",
      );
      expect(fresh.map((i) => i.dueOn)).toEqual(["2026-11-05"]);
      const old = scheduledItems(
        { ...inputs(), recurring: [{ ...rent, startsOn: "2025-01-01" }] },
        "2026-12-20",
        "2026-12-21",
      );
      expect(old.map((i) => i.dueOn)).toEqual(["2026-12-05"]);
    });

    it("never back-fills pay or income", () => {
      const items = scheduledItems(
        {
          ...inputs(),
          recurring: [
            { ...payday, startsOn: "2026-09-01" },
            { ...allowance, startsOn: "2026-09-01", endsOn: null },
          ],
        },
        TODAY,
        "2026-11-03",
      );
      expect(items.every((i) => i.dueOn >= TODAY)).toBe(true);
    });
  });

  it("keeps unlogged planned items from before today, and planned income flows in", () => {
    const withPlanned = scheduledItems(
      inputs({
        planned: [
          {
            id: "late",
            type: "expense",
            name: "Tuition",
            amount: 5000,
            category: "family",
            dueOn: "2026-10-30",
            accountId: null,
            transactionId: null,
          },
          {
            id: "bonus",
            type: "income",
            name: "13th month",
            amount: 20000,
            category: "salary",
            dueOn: "2026-11-20",
            accountId: null,
            transactionId: null,
          },
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
          {
            id: "i1",
            name: "Shoes (1 of 3)",
            dueOn: "2026-10-25",
            amount: 1045,
            payFromAccountId: "gcash",
            transactionId: null,
          },
          {
            id: "i2",
            name: "Shoes (2 of 3)",
            dueOn: "2026-11-25",
            amount: 1045,
            payFromAccountId: "gcash",
            transactionId: null,
          },
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

describe("next payday you haven't received", () => {
  describe("pay received early", () => {
    const today = "2026-11-13";
    const philhealth = { ...rent, id: "philhealth", name: "PhilHealth", amount: 500, day1: 15 };
    const water = { ...rent, id: "water", name: "Water", amount: 1000, day1: 20 };
    const early = (received: boolean, extra: Partial<ScheduleInputs> = {}) =>
      scheduledItems(
        {
          recurring: [payday, philhealth, water, rent],
          billPayments: [
            { recurringItemId: "philhealth", dueOn: "2026-11-15", transactionId: "t-philhealth" },
            ...(received
              ? [{ recurringItemId: "pay", dueOn: "2026-11-15", transactionId: "t-pay" }]
              : []),
          ],
          planned: [
            {
              id: "side",
              type: "income",
              name: "Side job",
              amount: 10000,
              category: "other_income",
              dueOn: "2026-11-15",
              accountId: "bank",
              transactionId: "t-side",
            },
          ],
          installments: [
            {
              id: "i1",
              name: "Bonchon",
              dueOn: "2026-11-16",
              amount: 355,
              payFromAccountId: "bank",
              transactionId: null,
            },
          ],
          ...extra,
        },
        today,
        "2026-12-13",
      );

    it("is the payday after it once the pay is in, and that payday again once undone", () => {
      expect(nextUnreceivedPayday(payday, early(true), today)).toBe("2026-11-30");
      expect(nextUnreceivedPayday(payday, early(false), today)).toBe("2026-11-15");
    });

    it("matches a payday moved to another day by its usual date", () => {
      const moved = early(true, {
        paydayAmounts: {
          "2026-11-15": { amount: 11471.25, estimate: false, paidOn: "2026-11-13" },
        },
      });
      expect(nextUnreceivedPayday(payday, moved, today)).toBe("2026-11-30");
    });

    it("skips every payday already received", () => {
      const both = early(true, {
        billPayments: [
          { recurringItemId: "pay", dueOn: "2026-11-15", transactionId: "t-pay" },
          { recurringItemId: "pay", dueOn: "2026-11-30", transactionId: "t-pay-2" },
        ],
      });
      expect(nextUnreceivedPayday(payday, both, today)).toBe("2026-12-15");
    });
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
    const no = affordVerdict({
      start: 7000,
      items,
      purchase: { name: "Phone", amount: 30000, first: TODAY, months: 1 },
      today: TODAY,
      nextPayday: "2026-11-15",
    });
    expect(no.tone).toBe("no");
    const wait = affordVerdict({
      start: 7000,
      items,
      purchase: { name: "Shoes", amount: 4000, first: TODAY, months: 1 },
      today: TODAY,
      nextPayday: "2026-11-15",
    });
    expect(wait.tone).toBe("wait");
  });

  it("counts your daily spending and the ₱1,000 floor, like Home", () => {
    const items = scheduledItems(inputs(), TODAY, "2026-12-02");
    const check = (amount: number) =>
      affordVerdict({
        start: 7000,
        items,
        purchase: { name: "Bag", amount, first: TODAY, months: 1 },
        today: TODAY,
        nextPayday: "2026-11-15",
      });
    // 9,000 today − 6,000 rent − ₱1,000 floor: ₱2,000 for the 7 days until
    // the next allowance, ₱280 a day.
    const small = check(100);
    expect(small.perDayBefore).toBe(280);
    expect(small.tone).toBe("comfortable");
    // The old check said "comfortably" (never below ₱0 when spending nothing),
    // but it cuts ₱280 a day to ₱70.
    const bag = check(1500);
    expect(bag.tone).toBe("tight");
    expect(bag.biggestCut).toEqual({ from: TODAY, before: 280, after: 70 });
    // Nothing left to spend until payday: wait for it.
    expect(check(2000).tone).toBe("wait");
  });

  it("splits an amount so the payments add back up exactly", () => {
    const parts = splitAmount(1000, 3);
    expect(parts).toEqual([333.33, 333.33, 333.34]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 10);
    // Whole centavos: no floating-point 1.14 + 1.16.
    expect(splitAmount(2.3, 2)).toEqual([1.15, 1.15]);
  });
});

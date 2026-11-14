import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import type { ForecastItem } from "@/lib/forecast";
import {
  billCycles,
  breathers,
  buildPaymentPlan,
  cappedPlan,
  earliestToPay,
  isBnplBill,
  PLAN_FLOOR,
  planToday,
  tomorrowsAmount,
} from "@/lib/payment-plan";

const today = "2026-11-15";
const day = (n: number) => addDays(today, n);

function item(dueIn: number, amount: number, extra: Partial<ForecastItem> = {}): ForecastItem {
  const flow = extra.flow ?? (amount < 0 ? "out" : "in");
  return {
    key: `${dueIn}|${amount}|${extra.name ?? ""}`,
    kind: flow === "in" ? "payday" : "bill",
    flow,
    id: `i${dueIn}${amount}`,
    name: extra.name ?? "item",
    amount: Math.abs(amount),
    dueOn: day(dueIn),
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
    ...extra,
  };
}

// ₱8,000 now, a ₱3,000 bill on day 5 and ₱6,000 pay on day 10.
const crunch = [item(5, -3000, { name: "SLoan" }), item(10, 6000, { name: "Payday" })];

describe("buildPaymentPlan", () => {
  it("spreads what's above ₱1,000 evenly when nothing is coming", () => {
    const plan = buildPaymentPlan({ start: 3000, items: [], today, days: 10 });
    expect(plan.perDay).toBe(200);
    expect(plan.segments).toEqual([{ from: today, until: day(10), perDay: 200 }]);
    expect(plan.lowest.balance).toBe(PLAN_FLOOR);
  });

  it("holds the amount down until the tight days are past, then raises it", () => {
    const plan = buildPaymentPlan({ start: 8000, items: crunch, today, days: 20 });
    // Days 0–9 share ₱8,000 − ₱3,000 − ₱1,000: ₱400 a day, down to ₱1,000 the day before payday.
    expect(plan.segments).toEqual([
      { from: today, until: day(10), perDay: 400 },
      { from: day(10), until: day(20), perDay: 600 },
    ]);
    expect(plan.lowest).toEqual({ date: day(9), balance: 1000 });
    expect(plan.cushion).toBe(0);
    expect(plan.short).toBe(false);
  });

  it("rounds down to ₱10 and keeps the rest as cushion", () => {
    const plan = buildPaymentPlan({ start: 8100, items: crunch, today, days: 20 });
    expect(plan.perDay).toBe(410);
    expect(plan.cushion).toBe(0);
    const roomy = buildPaymentPlan({ start: 8095, items: crunch, today, days: 20 });
    expect(roomy.perDay).toBe(400);
    expect(roomy.cushion).toBe(95);
  });

  it("counts late bills today and skips paid ones", () => {
    const late = buildPaymentPlan({ start: 3000, items: [item(-3, -1000)], today, days: 10 });
    expect(late.perDay).toBe(100);
    const paid = buildPaymentPlan({ start: 3000, items: [item(2, -1000, { transactionId: "t" })], today, days: 10 });
    expect(paid.perDay).toBe(200);
  });

  it("says when even ₱0 a day can't keep ₱1,000", () => {
    const plan = buildPaymentPlan({ start: 2000, items: [item(3, -1500)], today, days: 10 });
    expect(plan.short).toBe(true);
    expect(plan.perDay).toBe(0);
  });
});

describe("earliestToPay", () => {
  const bill = item(15, -500, { name: "Atome" });
  const plan = buildPaymentPlan({ start: 8000, items: [...crunch, bill], today, days: 20 });

  it("waits for payday when paying sooner would dip under ₱1,000", () => {
    expect(earliestToPay(bill, plan, today)).toBe(day(10));
  });

  it("is today when there's room, or when it's already due", () => {
    const roomy = buildPaymentPlan({ start: 20000, items: [...crunch, bill], today, days: 20 });
    expect(earliestToPay(bill, roomy, today)).toBe(today);
    expect(earliestToPay(item(-1, -200), plan, today)).toBe(today);
  });

  it("is safe early when the days before it have room, even if later days don't", () => {
    // Paying early only lowers the days before it's due: days 0–4 have ₱6,000 or more.
    expect(earliestToPay(crunch[0], plan, today)).toBe(today);
  });

  it("is its own due date when the day before it is already at ₱1,000", () => {
    const onPayday = item(10, -500, { name: "IPhone" });
    const tight = buildPaymentPlan({ start: 8000, items: [...crunch, onPayday], today, days: 20 });
    expect(earliestToPay(onPayday, tight, today)).toBe(day(10));
  });
});

describe("tomorrowsAmount", () => {
  it("drops when today went past the cushion", () => {
    const base = { start: 8000, items: crunch, today, days: 20 };
    expect(tomorrowsAmount({ ...base, cashSpentToday: 400 })).toBe(400);
    // ₱900 over spread over the 9 days left before payday is ₱100 less a day.
    expect(tomorrowsAmount({ ...base, cashSpentToday: 1300 })).toBe(300);
  });
});

describe("planToday", () => {
  const base = { items: crunch, today };

  it("starts from this morning: cash spent today is added back", () => {
    const t = planToday({ ...base, inWallets: 7800, cash: 200 });
    expect(t.start).toBe(8000);
    expect(t.left).toBe(t.plan.perDay - 200);
  });

  it("only works out tomorrow once you're past the cushion", () => {
    expect(planToday({ ...base, inWallets: 7800, cash: 200 }).tomorrow).toBeNull();
    expect(planToday({ ...base, inWallets: 7000, cash: 1000 }).tomorrow).not.toBeNull();
  });
});

describe("BNPL caps", () => {
  // Atome: cutoff the 6th, due the 16th. Today (Nov 15) lands on the Dec 16 bill.
  const atome = { id: "atome", name: "Atome", dueDay: 16, cutoffDay: 6, creditLeft: 10000, used: 0 };
  const pay = (dueOn: string, amount: number) => item(0, amount, { dueOn, key: `pay|${dueOn}`, name: "Payday" });
  const paydays = ["2026-11-30", "2026-12-15", "2026-12-30", "2027-01-15", "2027-01-30", "2027-02-15"].map((d) => pay(d, 10000));

  it("groups days by the bill they land on", () => {
    const [first, second] = billCycles(atome, today);
    expect(first).toMatchObject({ due: "2026-12-16", from: "2026-11-07", until: "2026-12-07", days: 30 });
    expect(second).toMatchObject({ due: "2027-01-16", from: "2026-12-07" });
  });

  it("gives BNPL at most a fifth of what you can spend a day, held on each bill day", () => {
    const capped = cappedPlan({ start: 10000, items: paydays, today, lines: [atome] });
    expect(capped.perDay).toBeGreaterThan(0);
    expect(capped.perDay).toBeLessThanOrEqual(capped.plan.perDay / 4);
    const dec16 = capped.caps.find((c) => c.due === "2026-12-16")!;
    expect(dec16.cap).toBe(capped.perDay * 30);
    expect(capped.held.find((h) => h.dueOn === "2026-12-16")?.amount).toBe(dec16.left);
    // Holding the caps lowers the daily cash amount.
    expect(capped.plan.perDay).toBeLessThan(buildPaymentPlan({ start: 10000, items: paydays, today }).perDay);
  });

  it("takes what you already bought off today's bill, never below ₱0", () => {
    const capped = cappedPlan({ start: 10000, items: paydays, today, lines: [{ ...atome, used: 999999 }] });
    expect(capped.caps.find((c) => c.due === "2026-12-16")!.left).toBe(0);
    expect(capped.held.some((h) => h.dueOn === "2026-12-16")).toBe(false);
  });

  it("has no caps when there's no room", () => {
    const capped = cappedPlan({ start: 1500, items: [], today, lines: [atome] });
    expect(capped.perDay).toBe(0);
    expect(capped.held).toEqual([]);
  });

  it("keeps BNPL bills to their due day", () => {
    const lines = new Set(["atome"]);
    expect(isBnplBill(item(5, -300, { lenderId: "atome" }), lines)).toBe(true);
    expect(isBnplBill(item(5, -300, { lenderId: "sloan" }), lines)).toBe(false);
  });
});

describe("breathers", () => {
  it("marks gaps of 5 days or more with nothing due", () => {
    expect(breathers([day(2), day(3), day(10)], today)).toEqual([
      { after: day(3), from: day(4), until: day(10), days: 6 },
    ]);
    expect(breathers([day(7)], today)).toEqual([{ after: null, from: today, until: day(7), days: 7 }]);
  });
});

import { describe, expect, it } from "vitest";
import { creditRoom } from "@/lib/bnpl";
import { scheduledItems } from "@/lib/forecast";
import {
  MAX_DATES,
  bestPicks,
  candidateDates,
  partsThatFit,
  setAsideFor,
  windowOf,
  type Wish,
} from "@/lib/wishlist";

const TODAY = "2026-11-02";

const twiceMonthly = { frequency: "twice_monthly" as const, day1: 15, day2: 30 };

const payday = {
  id: "pay",
  kind: "payday" as const,
  name: "Payday",
  amount: 15000,
  amountVaries: false,
  accountId: "bank",
  category: null,
  ...twiceMonthly,
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

// ₱7,000 now, ₱15,000 every 15th and 30th, ₱6,000 rent every 5th.
const items = scheduledItems(
  { recurring: [payday, rent], billPayments: [], planned: [], installments: [] },
  TODAY,
  "2028-01-01",
);

const spay = creditRoom([
  {
    id: "spay",
    name: "SPayLater",
    type: "credit_line",
    balance: 0,
    creditLimit: 30000,
    dueDay: 5,
  },
]);

const wish = (patch: Partial<Wish> = {}): Wish => ({
  id: "w1",
  name: "Siargao trip",
  amount: 18000,
  category: "fun",
  earliest: TODAY,
  by: null,
  feeRate: 0,
  ...patch,
});

const pick = (w: Wish, credit = spay) =>
  bestPicks({ wish: w, start: 7000, items, today: TODAY, payday: twiceMonthly, credit, cap: null });

describe("the window Pong looks in", () => {
  it("starts today at the earliest, and runs to by, or a year on", () => {
    expect(windowOf({ earliest: "2026-10-01", by: null }, TODAY)).toEqual({
      from: TODAY,
      last: "2027-11-02",
    });
    expect(windowOf({ earliest: "2027-02-01", by: "2027-05-31" }, TODAY)).toEqual({
      from: "2027-02-01",
      last: "2027-05-31",
    });
    // Never more than a year from today: the forecast doesn't reach further.
    expect(windowOf({ earliest: "2027-06-01", by: "2028-06-01" }, TODAY).last).toBe("2027-11-02");
  });

  it("checks the first day, each payday and the last day", () => {
    expect(candidateDates({ earliest: TODAY, by: "2026-12-31" }, TODAY, twiceMonthly)).toEqual([
      "2026-11-02",
      "2026-11-15",
      "2026-11-30",
      "2026-12-15",
      "2026-12-30",
      "2026-12-31",
    ]);
  });

  it("thins a daily payday to MAX_DATES, keeping the first and last", () => {
    const daily = { frequency: "daily" as const, day1: 0, day2: null };
    const dates = candidateDates({ earliest: TODAY, by: null }, TODAY, daily);
    expect(dates.length).toBeLessThanOrEqual(MAX_DATES);
    expect(dates[0]).toBe(TODAY);
    expect(dates.at(-1)).toBe("2027-11-02");
  });
});

describe("setting money aside", () => {
  it("splits the amount over the paydays until the date", () => {
    // Nov 15, Nov 30, Dec 15.
    expect(setAsideFor(18000, "2026-12-15", TODAY, twiceMonthly)).toEqual({
      perPayday: 6000,
      paydays: 3,
    });
    expect(setAsideFor(18000, "2026-11-10", TODAY, twiceMonthly)).toBeNull();
    expect(setAsideFor(18000, "2026-12-15", TODAY, null)).toBeNull();
  });
});

describe("Pong's pick", () => {
  it("waits for the soonest date it's comfortable, from your own money", () => {
    const r = pick(wish());
    expect(r.best).not.toBeNull();
    // ₱7,000 today can't buy ₱18,000.
    expect(r.best!.date > TODAY).toBe(true);
    expect(r.best!.borrowed).toBe(false);
    expect(r.best!.verdict.tone).toBe("comfortable");
    expect(r.why).toMatch(/soonest it fits comfortably/);
    // Not just the last day of the window: waiting longer always cuts less.
    expect(r.best!.date < r.window.last).toBe(true);
  });

  it("stays inside the window", () => {
    const r = pick(wish({ earliest: "2027-02-01", by: "2027-05-31" }));
    expect(r.best!.date >= "2027-02-01" && r.best!.date <= "2027-05-31").toBe(true);
  });

  it("borrows only when your own money can't do it in time", () => {
    const soon = pick(wish({ by: "2026-11-10" }));
    expect(soon.best!.borrowed).toBe(true);
    expect(soon.best!.strategy).toMatchObject({ kind: "credit", lineId: "spay" });
    expect(soon.why).toMatch(/doesn't fit by Nov 10/);
    // No credit lines: nothing fits by then.
    const none = pick(wish({ by: "2026-11-10" }), []);
    expect(none.best).toBeNull();
    expect(none.why).toMatch(/^Nothing fits from/);
  });

  it("puts the fee in what you'd pay on credit", () => {
    const r = pick(wish({ by: "2026-11-10", feeRate: 2 }));
    expect(r.best!.fees).toBeGreaterThan(0);
    const paid = r.best!.payments.reduce((sum, p) => sum + p.amount, 0);
    expect(paid).toBeCloseTo(18000 + r.best!.fees, 2);
  });

  it("offers up to two other ways, each different from the pick", () => {
    const r = pick(wish());
    const kinds = [r.best!, ...r.others].map((p) =>
      p.strategy.kind === "credit" ? `credit|${p.strategy.lineId}` : p.strategy.kind,
    );
    expect(r.others.length).toBeLessThanOrEqual(2);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("pays off parts from your wallets by the pay off by date", () => {
    const r = pick(wish({ earliest: "2027-02-11", by: "2027-07-11" }), []);
    const parts = [r.best!, ...r.others].filter((p) => p.strategy.kind === "installments");
    for (const p of [r.best!, ...r.others]) {
      expect(p.payments.every((x) => x.dueOn >= "2027-02-11" && x.dueOn <= "2027-07-11")).toBe(
        true,
      );
    }
    for (const p of parts) expect(p.label).toMatch(/ → .*\(\d+ payments\)$/);
  });

  it("offers no parts when the start and pay off by dates are the same day", () => {
    const r = pick(wish({ amount: 5000, earliest: "2027-12-30", by: "2027-12-30" }), []);
    expect(r.best!.strategy).toEqual({ kind: "full" });
    expect(r.best!.label).toBe("Pay ₱5,000 on Dec 30, 2027 from your wallets");
    expect(r.others.every((p) => p.strategy.kind !== "installments")).toBe(true);
  });

  it("says when you buy on credit and when its bills come", () => {
    const r = pick(wish({ by: "2026-11-10" }));
    expect(r.best!.label).toMatch(/^Buy Nov \d+ on SPayLater/);
  });

  it("is the same whatever else is on the wishlist: it only sees your forecast", () => {
    // A second wish never goes into `items`, so the first one's pick doesn't move.
    const alone = pick(wish());
    pick(wish({ id: "w2", name: "Phone", amount: 24000 }));
    expect(pick(wish())).toEqual(alone);
  });
});

describe("parts that fit", () => {
  it("counts the monthly parts from the first date up to the last", () => {
    expect(partsThatFit("2027-02-11", "2027-07-11")).toBe(6);
    expect(partsThatFit("2027-02-11", "2027-07-10")).toBe(5);
    expect(partsThatFit("2027-12-30", "2027-12-30")).toBe(1);
    expect(partsThatFit("2027-01-01", "2030-01-01")).toBe(24);
  });
});

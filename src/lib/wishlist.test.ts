import { describe, expect, it } from "vitest";
import { creditRoom } from "@/lib/bnpl";
import { scheduledItems } from "@/lib/forecast";
import {
  MAX_DATES,
  bestPicks,
  candidateDates,
  partsThatFit,
  saveUpDates,
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

  it("pays after, on credit, when saving it in time doesn't fit", () => {
    // ₱18,000 by Nov 10: no payday before then, so it'd all be set aside today.
    const soon = pick(wish({ by: "2026-11-10" }));
    expect(soon.best!.borrowed).toBe(true);
    expect(soon.best!.strategy).toMatchObject({ kind: "credit", lineId: "spay" });
    expect(soon.best!.date).toBe("2026-11-10");
    expect(soon.why).toMatch(/paying after is the gentlest way/);
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

  it("saves up each payday from save from until the day before ready by", () => {
    // The design review's example: ₱30,000, save from Jan 13, ready by Jul 11.
    const r = pick(wish({ amount: 30000, earliest: "2027-01-13", by: "2027-07-11" }));
    expect(r.best!.strategy).toEqual({ kind: "save" });
    expect(r.best!.payments.map((p) => p.dueOn)).toEqual([
      "2027-01-15",
      "2027-01-30",
      "2027-02-15",
      "2027-02-28",
      "2027-03-15",
      "2027-03-30",
      "2027-04-15",
      "2027-04-30",
      "2027-05-15",
      "2027-05-30",
      "2027-06-15",
      "2027-06-30",
    ]);
    expect(r.best!.payments.every((p) => p.amount === 2500)).toBe(true);
    expect(r.best!.label).toBe("Save ₱2,500 each payday, Jan 15 → Jun 30, 2027 (12 paydays)");
    expect(r.best!.borrowed).toBe(false);
    // Nothing changes before the first set-aside.
    const cutFrom = r.best!.verdict.biggestCut?.from;
    expect(cutFrom === undefined || cutFrom >= "2027-01-15").toBe(true);
    expect(r.why).toMatch(/all saved by Jul 11/);
    // The other ways pay after: from the ready-by date on.
    for (const p of r.others) {
      expect(p.strategy.kind).not.toBe("save");
      expect(p.payments.every((x) => x.dueOn >= "2027-07-11")).toBe(true);
    }
  });

  it("saves it all on the day when save from and ready by are the same day", () => {
    const r = pick(wish({ amount: 5000, earliest: "2027-12-30", by: "2027-12-30" }), []);
    expect(r.best!.strategy).toEqual({ kind: "save" });
    expect(r.best!.label).toBe("Save ₱5,000 on Dec 30, 2027");
    expect(r.best!.payments).toEqual([{ dueOn: "2027-12-30", amount: 5000 }]);
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

describe("saving up", () => {
  it("starts today when save from has passed, and stops before ready by", () => {
    expect(saveUpDates({ earliest: "2026-10-01", by: "2026-12-15" }, TODAY, twiceMonthly)).toEqual([
      "2026-11-15",
      "2026-11-30",
    ]);
  });

  it("goes monthly on the save-from day without a payday", () => {
    expect(saveUpDates({ earliest: "2027-01-13", by: "2027-04-13" }, TODAY, null)).toEqual([
      "2027-01-13",
      "2027-02-13",
      "2027-03-13",
    ]);
  });

  it("saves it all on save from when no payday comes before ready by", () => {
    expect(saveUpDates({ earliest: "2027-01-01", by: "2027-01-10" }, TODAY, twiceMonthly)).toEqual([
      "2027-01-01",
    ]);
  });

  it("puts the centavos left over on the last set-aside", () => {
    const r = pick(wish({ amount: 1000, earliest: "2027-01-01", by: "2027-02-14" }));
    // Jan 15, Jan 30: ₱500 each.
    expect(r.best!.payments.map((p) => p.amount)).toEqual([500, 500]);
    const odd = pick(wish({ amount: 1000, earliest: "2027-01-01", by: "2027-02-16" }));
    // Jan 15, Jan 30, Feb 15: ₱333.33 twice, then ₱333.34.
    expect(odd.best!.payments.map((p) => p.amount)).toEqual([333.33, 333.33, 333.34]);
  });
});

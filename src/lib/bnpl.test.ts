import { describe, expect, it } from "vitest";
import { affordWithCredit, bnplCap, creditRoom, estimateMonth, payCycle, totalUsable, usableOn } from "@/lib/bnpl";
import { scheduledItems, type ScheduleInputs } from "@/lib/forecast";

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

const rent = { ...payday, id: "rent", kind: "bill" as const, name: "Rent", amount: 6000, frequency: "monthly" as const, day1: 5, day2: null };

function itemsWith(extra: Partial<ScheduleInputs> = {}) {
  return scheduledItems({ recurring: [payday, rent], billPayments: [], planned: [], ...extra }, TODAY, "2027-03-01");
}

const shoes = (dueOn: string, amount = 1500) => ({ id: `shoes-${dueOn}`, name: "Shoes (1 of 3)", dueOn, amount, payFromAccountId: "gcash", transactionId: null });

// ₱30,000 a month in, ₱22,000 out: ₱8,000 left over.
const history = { income: 90000, spending: 66000, months: 3 };

const accounts = [
  { id: "gcash", name: "GCash", type: "ewallet" as const, balance: 3000, creditLimit: null, dueDay: null },
  { id: "spay", name: "SPayLater", type: "credit_line" as const, balance: -5000, creditLimit: 10000, dueDay: 5 },
  { id: "atome", name: "Atome", type: "credit_line" as const, balance: 0, creditLimit: 3000, dueDay: 10 },
  { id: "bpi", name: "BPI credit", type: "credit_line" as const, balance: -1200, creditLimit: null, dueDay: null },
];

describe("credit left on each line", () => {
  it("is the limit minus what you owe, for credit lines only", () => {
    expect(creditRoom(accounts).map((l) => [l.name, l.owed, l.creditLeft])).toEqual([
      ["SPayLater", 5000, 5000],
      ["Atome", 0, 3000],
      ["BPI credit", 1200, null],
    ]);
  });

  it("never goes below 0, and an overpaid line owes nothing", () => {
    const [over, paidAhead] = creditRoom([
      { id: "a", name: "A", type: "credit_line", balance: -12000, creditLimit: 10000, dueDay: null },
      { id: "b", name: "B", type: "credit_line", balance: 200, creditLimit: 1000, dueDay: null },
    ]);
    expect(over.creditLeft).toBe(0);
    expect(paidAhead).toMatchObject({ owed: 0, creditLeft: 1000 });
  });
});

describe("Pong's monthly BNPL cap", () => {
  it("keeps all installments under 15% of take-home and half of what's left over", () => {
    const cap = bnplCap({ history, items: itemsWith({ installments: [shoes("2026-11-20")] }), start: 7000, today: TODAY, used: 1000 });
    expect(cap).toMatchObject({
      status: "set",
      income: 30000,
      spending: 22000,
      surplus: 8000,
      byIncome: 4500,
      bySurplus: 4000,
      ceiling: 4000,
      debtPayments: 1500,
      // ₱4,000 − ₱1,500 already running = ₱2,500 of new BNPL; ₱1,000 used.
      cap: 2500,
      left: 1500,
    });
  });

  it("only counts installments due in the next 30 days, and rounds down to ₱100", () => {
    const cap = bnplCap({
      history,
      items: itemsWith({ installments: [shoes("2026-11-20", 1450), shoes("2026-12-20", 1450)] }),
      start: 7000,
      today: TODAY,
      used: 0,
    });
    expect(cap).toMatchObject({ debtPayments: 1450, cap: 2500 });
  });

  it("pauses while a bill or installment is late", () => {
    const cap = bnplCap({ history, items: itemsWith({ installments: [shoes("2026-10-25")] }), start: 7000, today: TODAY, used: 0 });
    expect(cap).toMatchObject({ status: "paused", cap: 0, left: 0 });
    expect(cap.reason).toContain("Shoes (1 of 3) is late");
  });

  it("pauses when the forecast dips below ₱0", () => {
    // ₱4,000 − ₱6,000 rent on Nov 5.
    const cap = bnplCap({ history, items: itemsWith(), start: 4000, today: TODAY, used: 0 });
    expect(cap).toMatchObject({ status: "paused", left: 0 });
    expect(cap.reason).toContain("below ₱0");
  });

  it("pauses when you spend all you take home", () => {
    const cap = bnplCap({ history: { income: 60000, spending: 61000, months: 2 }, items: itemsWith(), start: 7000, today: TODAY, used: 0 });
    expect(cap).toMatchObject({ status: "paused", surplus: -500 });
  });

  it("pauses when installments already fill the ceiling", () => {
    const cap = bnplCap({ history, items: itemsWith({ installments: [shoes("2026-11-20", 4000)] }), start: 7000, today: TODAY, used: 0 });
    expect(cap).toMatchObject({ status: "paused", cap: 0 });
  });

  it("pauses on a dip below ₱0 even before there are records", () => {
    const cap = bnplCap({ history: { income: 0, spending: 0, months: 0 }, items: itemsWith(), start: 4000, today: TODAY, used: 0 });
    expect(cap).toMatchObject({ status: "paused", left: 0 });
  });

  it("has no cap until there's a month of records", () => {
    const cap = bnplCap({ history: { income: 0, spending: 0, months: 0 }, items: itemsWith(), start: 7000, today: TODAY, used: 0 });
    expect(cap).toMatchObject({ status: "unknown", cap: null, left: null });
  });
});

describe("a month estimated before there's a full month of records", () => {
  const items = itemsWith({ installments: [shoes("2026-11-20")] });

  it("takes your pay and bills in the next 30 days, plus day-to-day spending at this month's rate", () => {
    // Paydays Nov 15 and 30: ₱30,000. Rent Dec 5: ₱6,000. ₱2,800 over 7 days = ₱12,000 a month.
    // The installment isn't spending here: the cap counts it on its own.
    expect(estimateMonth({ items, today: TODAY, dayToDay: 2800, daysLogged: 7 })).toEqual({
      income: 30000,
      spending: 18000,
      months: 1,
      estimated: true,
    });
  });

  it("waits for a week of records", () => {
    expect(estimateMonth({ items, today: TODAY, dayToDay: 500, daysLogged: 6 })).toBeNull();
  });

  it("sets a cap from it, marked as an estimate", () => {
    const history = estimateMonth({ items, today: TODAY, dayToDay: 2800, daysLogged: 7 })!;
    const cap = bnplCap({ history, items, start: 7000, today: TODAY, used: 0 });
    // Smaller of 15% × ₱30,000 = ₱4,500 and half of ₱12,000 left = ₱6,000; − ₱1,500 running.
    expect(cap).toMatchObject({ status: "set", estimated: true, ceiling: 4500, cap: 3000 });
  });
});

describe("what you can still use", () => {
  const lines = creditRoom(accounts);

  it("is the limits left, but never past the cap", () => {
    const withLimits = lines.slice(0, 2);
    expect(totalUsable(withLimits, null)).toBe(8000);
    expect(totalUsable(withLimits, 1500)).toBe(1500);
    expect(totalUsable(withLimits, 20000)).toBe(8000);
    // A line without a limit: only the cap holds it back.
    expect(totalUsable(lines, 1500)).toBe(1500);
    expect(usableOn(lines[2], null)).toBeNull();
    expect(usableOn(lines[1], 1500)).toBe(1500);
  });
});

describe("pay cycle", () => {
  it("runs from the payday on or before a date to the next one", () => {
    expect(payCycle(twiceMonthly, "2026-12-05")).toEqual({ from: "2026-11-30", until: "2026-12-15" });
    expect(payCycle(twiceMonthly, "2026-12-15")).toEqual({ from: "2026-12-15", until: "2026-12-30" });
  });
});

describe("can I afford this with BNPL", () => {
  const items = itemsWith();
  const lines = creditRoom(accounts);
  const cap = bnplCap({ history, items, start: 7000, today: TODAY, used: 1000 });

  it("pays it back on each line's due days, from your own money, within the cap", () => {
    expect(cap).toMatchObject({ cap: 4000, left: 3000 });
    const [spay, atome, bpi] = affordWithCredit({
      start: 7000,
      items,
      purchase: { name: "Shoes", amount: 2400, first: TODAY, months: 1 },
      today: TODAY,
      payday: twiceMonthly,
      lines,
      cap,
    });
    // Bought Nov 2: the Nov 5 bill is too soon, so it's on Dec 5.
    expect(spay).toMatchObject({ room: 3000, capped: true, fits: true, firstDue: "2026-12-05", payment: 2400 });
    // ₱7,000 − ₱6,000 rent leaves ₱1,000 on Nov 5, but two paydays land before Dec 5.
    expect(spay.verdict!.tone).toBe("comfortable");
    // Dec 5 is in the Nov 30 – Dec 15 kinsenas: 15 days.
    expect(spay.cycle).toEqual({ from: "2026-11-30", until: "2026-12-15" });
    expect(spay.perDay).toBe(160);
    // Atome's ₱3,000 limit and the ₱3,000 left of the cap are the same.
    expect(atome).toMatchObject({ room: 3000, capped: false, fits: true });
    // No limit saved: the cap is all that holds it back.
    expect(bpi).toMatchObject({ room: 3000, capped: true });
  });

  it("says no past the cap, and a later month starts over", () => {
    const now = affordWithCredit({ start: 7000, items, purchase: { name: "Phone", amount: 3500, first: TODAY, months: 3 }, today: TODAY, payday: null, lines, cap });
    expect(now.every((o) => !o.fits)).toBe(true);
    const december = affordWithCredit({ start: 7000, items, purchase: { name: "Phone", amount: 3500, first: "2026-12-01", months: 3 }, today: TODAY, payday: null, lines, cap });
    expect(december[0]).toMatchObject({ room: 4000, fits: true, payment: 1166.66 });
  });

  it("offers nothing that fits while BNPL is paused", () => {
    const paused = bnplCap({ history, items, start: 4000, today: TODAY, used: 0 });
    const options = affordWithCredit({ start: 4000, items, purchase: { name: "Bag", amount: 500, first: TODAY, months: 1 }, today: TODAY, payday: null, lines, cap: paused });
    expect(options.every((o) => !o.fits && o.room === 0)).toBe(true);
  });
});

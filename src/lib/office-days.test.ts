import { describe, expect, it } from "vitest";
import { paidInAdvance, type ForecastItem } from "@/lib/forecast";
import { billsByPayday, officeDays } from "@/lib/office-days";
import type { PayrollRecords, PayrollSettings } from "@/lib/payroll";

const settings: PayrollSettings = {
  dailyRate: 1000,
  hoursPerDay: 8,
  startTime: "08:00",
  overtimeRate: 1,
  monthlyBase: null,
  startedOn: null,
  paySss: false,
  payPhilhealth: false,
  payPagibig: false,
  payTax: false,
  sssAmount: null,
  philhealthAmount: null,
  pagibigAmount: null,
};

const records: PayrollRecords = { settings, days: [], overtime: [] };
const PAYDAY = { frequency: "twice_monthly" as const, day1: 15, day2: 30 };

function item(kind: ForecastItem["kind"], dueOn: string, amount: number, flow: "in" | "out" = "out"): ForecastItem {
  return {
    key: `${kind}|${dueOn}|${amount}`,
    kind,
    flow,
    id: `${kind}-${dueOn}`,
    name: kind,
    amount,
    dueOn,
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
  };
}

describe("office days in a cutoff", () => {
  // Monday Nov 9, 2026: Nov 1–15 has 10 weekdays, 5 of them before today (Nov 2–6).
  it("counts what's earned before today and the work days left", () => {
    const days = officeDays(records, { start: "2026-11-01", end: "2026-11-15" }, "2026-11-09", 7200);
    expect(days.earned).toBe(5000);
    expect(days.daysLeft).toBe(5);
    expect(days.firstDay).toBe("2026-11-09");
    // ₱2,200 more at ₱1,000 a day: 3 days.
    expect(days.needed).toBe(3);
    expect(days.short).toBe(0);
  });

  it("leaves out days marked off or on leave, and says how short it is", () => {
    const off: PayrollRecords = {
      settings,
      days: [
        { date: "2026-11-12", status: "off", leaveType: null, note: null, timeIn: null },
        { date: "2026-11-13", status: "leave", leaveType: "sick", note: null, timeIn: null },
      ],
      overtime: [],
    };
    const days = officeDays(off, { start: "2026-11-01", end: "2026-11-15" }, "2026-11-09", 9000);
    expect(days.daysLeft).toBe(3);
    expect(days.needed).toBeNull();
    expect(days.short).toBe(1000);
  });

  it("needs no days when what's earned already covers it", () => {
    expect(officeDays(records, { start: "2026-11-01", end: "2026-11-15" }, "2026-11-09", 4000).needed).toBe(0);
  });
});

describe("bills by payday", () => {
  const items = [
    item("bill", "2026-11-05", 300), // late
    item("bill", "2026-11-10", 700),
    item("payday", "2026-11-15", 10000, "in"),
    item("installment", "2026-11-16", 6000),
    item("bill", "2026-11-25", 1500),
    item("income", "2026-11-20", 500, "in"),
    item("payday", "2026-11-30", 11000, "in"),
    item("bill", "2026-12-05", 2000),
    item("pautang", "2026-12-06", 900, "in"),
  ];

  it("puts each bill with the pay that covers it, late ones before the first payday", () => {
    const periods = billsByPayday({ items, today: "2026-11-09", payday: PAYDAY, inWallets: 5000, payroll: records, count: 2 });
    expect(periods.map((p) => [p.payday, p.from, p.to])).toEqual([
      [null, "2026-11-09", "2026-11-14"],
      ["2026-11-15", "2026-11-15", "2026-11-29"],
      ["2026-11-30", "2026-11-30", "2026-12-14"],
    ]);
    expect(periods[0].total).toBe(1000);
    expect(periods[0].left).toBe(4000);
    // Nov 15 pays for Oct 16–31 (11 weekdays, all done): ₱11,000 covers ₱7,500 of bills less ₱500 allowance.
    expect(periods[1].cutoff).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    expect(periods[1].need).toBe(7000);
    expect(periods[1].office?.earned).toBe(11000);
    expect(periods[1].office?.daysLeft).toBe(0);
    expect(periods[1].office?.needed).toBe(0);
    expect(periods[1].money).toBe(10000);
    // Nov 30 pays for Nov 1–15: ₱5,000 earned by Nov 6, 5 days left.
    // Pautang you count on (₱900 on Dec 6) lowers what the pay has to cover.
    expect(periods[2].cutoff).toEqual({ start: "2026-11-01", end: "2026-11-15" });
    expect(periods[2].need).toBe(1100);
    expect(periods[2].office?.daysLeft).toBe(5);
    expect(periods[2].office?.needed).toBe(0);
  });

  it("carries what a pay can't cover into the next one", () => {
    const big = [...items, item("installment", "2026-11-20", 20000)];
    const periods = billsByPayday({ items: big, today: "2026-11-09", payday: PAYDAY, inWallets: 5000, payroll: records, count: 2 });
    // ₱27,000 needed, and Oct 16–31 already earned ₱11,000 with no days left: ₱16,000 short.
    expect(periods[1].office?.needed).toBeNull();
    expect(periods[1].office?.short).toBe(16000);
    expect(periods[2].carriedIn).toBe(16000);
    expect(periods[2].need).toBe(17100);
    // Nov 1–15: ₱5,000 earned, ₱5,000 more at most: ₱7,100 short.
    expect(periods[2].office?.short).toBe(7100);
  });

  it("works without the payroll calculator, from the payday amount", () => {
    const periods = billsByPayday({ items, today: "2026-11-09", payday: PAYDAY, inWallets: 500, payroll: null, count: 2 });
    expect(periods[0].left).toBe(-500);
    expect(periods[1].office).toBeNull();
    expect(periods[1].carriedIn).toBe(500);
    expect(periods[1].left).toBe(roundTo(10000 - 7500 + 500 - 500));
  });

  it("skips the days before payday when nothing's due in them", () => {
    const later = items.filter((i) => i.dueOn >= "2026-11-15");
    const periods = billsByPayday({ items: later, today: "2026-11-09", payday: PAYDAY, inWallets: 0, payroll: null, count: 2 });
    expect(periods[0].payday).toBe("2026-11-15");
  });

  it("lists bills paid in advance under their pay without counting them", () => {
    // The Dec 5 bill, paid on Nov 9 from what you had then.
    const early = { ...item("bill", "2026-12-05", 2000), transactionId: "t1", paidOn: "2026-11-09" };
    const paid = items.map((i) => (i.dueOn === "2026-12-05" ? early : i));
    const periods = billsByPayday({ items: paid, today: "2026-11-09", payday: PAYDAY, inWallets: 5000, payroll: records, count: 2 });
    expect(periods[2].paidEarly.map((i) => i.dueOn)).toEqual(["2026-12-05"]);
    expect(periods[2].bills.some((i) => i.dueOn === "2026-12-05")).toBe(false);
    // ₱1,100 less the ₱2,000 bill, with the ₱900 pautang still counted: nothing left to cover.
    expect(periods[2].need).toBe(0);
    expect(periods[1].paidEarly).toEqual([]);
  });

  it("only tags what was paid before its due date", () => {
    const bill = item("bill", "2026-12-05", 2000);
    expect(paidInAdvance({ ...bill, transactionId: "t", paidOn: "2026-11-09" })).toBe(true);
    expect(paidInAdvance({ ...bill, transactionId: "t", paidOn: "2026-12-05" })).toBe(false);
    expect(paidInAdvance({ ...bill, transactionId: null, paidOn: null })).toBe(false);
    expect(paidInAdvance({ ...item("income", "2026-12-05", 500, "in"), transactionId: "t", paidOn: "2026-11-09" })).toBe(false);
  });
});

function roundTo(n: number) {
  return Math.round(n * 100) / 100;
}

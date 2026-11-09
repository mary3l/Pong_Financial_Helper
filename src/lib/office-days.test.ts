import { describe, expect, it } from "vitest";
import type { ForecastItem } from "@/lib/forecast";
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
    // Nov 15 pay covers ₱7,500 of bills less ₱500 allowance: ₱7,000, and ₱5,000 is earned by Nov 6.
    expect(periods[1].need).toBe(7000);
    expect(periods[1].office?.needed).toBe(2);
    expect(periods[1].money).toBe(10000);
    // Nov 30 pay: its whole cutoff (Nov 16–30, 11 weekdays) is ahead.
    // Pautang you count on (₱900 on Dec 6) lowers what the pay has to cover.
    expect(periods[2].need).toBe(1100);
    expect(periods[2].office?.daysLeft).toBe(11);
    expect(periods[2].office?.needed).toBe(2);
  });

  it("carries what a pay can't cover into the next one", () => {
    const big = [...items, item("installment", "2026-11-20", 20000)];
    const periods = billsByPayday({ items: big, today: "2026-11-09", payday: PAYDAY, inWallets: 5000, payroll: records, count: 2 });
    // ₱27,000 needed, ₱5,000 earned, ₱5,000 more at most this cutoff: ₱17,000 short.
    expect(periods[1].office?.needed).toBeNull();
    expect(periods[1].office?.short).toBe(17000);
    expect(periods[2].carriedIn).toBe(17000);
    expect(periods[2].need).toBe(18100);
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
});

function roundTo(n: number) {
  return Math.round(n * 100) / 100;
}

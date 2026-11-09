import { describe, expect, it } from "vitest";
import {
  contributions,
  cutoffFor,
  cutoffPay,
  daysFor,
  minutesLate,
  overtimeMinutes,
  pagibigContribution,
  paydayAmounts,
  paydayFor,
  payForCutoff,
  philhealthContribution,
  sssContribution,
  sssSalaryCredit,
  taxOnGross,
  taxPayments,
  upcomingTaxPayments,
  type PayrollDay,
  type PayrollRecords,
  type PayrollSettings,
} from "@/lib/payroll";

const settings: PayrollSettings = {
  dailyRate: 800,
  hoursPerDay: 8,
  startTime: "08:00",
  overtimeRate: 1,
  monthlyBase: null,
  startedOn: null,
  paySss: true,
  payPhilhealth: true,
  payPagibig: true,
  payTax: true,
  sssAmount: null,
  philhealthAmount: null,
  pagibigAmount: null,
};

const NOV_1 = { start: "2026-11-01", end: "2026-11-15" };

describe("late and overtime", () => {
  it("counts minutes after the start time", () => {
    expect(minutesLate("08:00", settings)).toBe(0);
    expect(minutesLate("07:45", settings)).toBe(0);
    expect(minutesLate("08:17", settings)).toBe(17);
    expect(minutesLate(null, settings)).toBe(0);
    // Never more than a full day.
    expect(minutesLate("23:00", settings)).toBe(480);
  });

  it("measures overtime, past midnight too", () => {
    expect(overtimeMinutes({ start: "17:00", end: "20:30" })).toBe(210);
    expect(overtimeMinutes({ start: "22:00", end: "01:00" })).toBe(180);
  });
});

describe("cutoff pay", () => {
  it("defaults to weekdays worked", () => {
    // Nov 1–15, 2026: Nov 1 is a Sunday, so 10 weekdays.
    const days = daysFor(NOV_1, new Map(), null);
    expect(days.filter((d) => d.status === "worked")).toHaveLength(10);
    expect(cutoffPay(settings, days, []).total).toBe(8000);
  });

  it("leaves are unpaid, late is per minute, overtime per hour", () => {
    const saved = new Map<string, PayrollDay>([
      ["2026-11-03", { date: "2026-11-03", status: "leave", leaveType: "sick", note: "Fever", timeIn: null }],
      ["2026-11-04", { date: "2026-11-04", status: "worked", leaveType: null, note: null, timeIn: "08:30" }],
    ]);
    const days = daysFor(NOV_1, saved, null);
    const pay = cutoffPay(settings, days, [{ date: "2026-11-07", start: "08:00", end: "12:00" }]);
    expect(pay.workedDays).toBe(9);
    expect(pay.sickDays).toBe(1);
    expect(pay.basePay).toBe(7200);
    // ₱100/hour → 30 minutes late = ₱50.
    expect(pay.lateMinutes).toBe(30);
    expect(pay.lateDeduction).toBe(50);
    // 4 hours on a Saturday at ₱100/hour.
    expect(pay.overtimePay).toBe(400);
    expect(pay.total).toBe(7550);
  });

  it("applies the overtime rate", () => {
    const pay = cutoffPay({ ...settings, overtimeRate: 1.25 }, [], [{ date: "2026-11-02", start: "17:00", end: "19:00" }]);
    expect(pay.overtimePay).toBe(250);
  });

  it("skips days before you started", () => {
    const days = daysFor(NOV_1, new Map(), "2026-11-09");
    expect(days.filter((d) => d.status === "worked")).toHaveLength(5);
  });

  it("is an estimate until saved and over", () => {
    const records: PayrollRecords = { settings, days: [], overtime: [] };
    expect(payForCutoff(records, NOV_1, "2026-11-20").estimate).toBe(true);
    const saved = { ...records, days: [{ date: "2026-11-02", status: "worked" as const, leaveType: null, note: null, timeIn: null }] };
    expect(payForCutoff(saved, NOV_1, "2026-11-10").estimate).toBe(true);
    expect(payForCutoff(saved, NOV_1, "2026-11-20").estimate).toBe(false);
  });

  it("pays each cutoff on the payday after it", () => {
    const schedule = { frequency: "twice_monthly" as const, day1: 15, day2: 30 };
    expect(cutoffFor("2026-11-15")).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    expect(cutoffFor("2026-11-30")).toEqual(NOV_1);
    expect(cutoffFor("2026-01-15")).toEqual({ start: "2025-12-16", end: "2025-12-31" });
    expect(paydayFor(NOV_1, schedule)).toBe("2026-11-30");
    expect(paydayFor({ start: "2026-11-16", end: "2026-11-30" }, schedule)).toBe("2026-12-15");
    expect(paydayFor({ start: "2027-02-01", end: "2027-02-15" }, schedule)).toBe("2027-02-28");
  });

  it("gives each payday the cutoff before it", () => {
    const records: PayrollRecords = { settings, days: [], overtime: [] };
    const amounts = paydayAmounts(records, { frequency: "twice_monthly", day1: 15, day2: 30 }, "2026-11-01", "2026-12-01", "2026-11-04");
    // Nov 15 pays Oct 16–31: 11 weekdays. Nov 30 pays Nov 1–15: 10 weekdays.
    expect(amounts).toEqual({
      "2026-11-15": { amount: 8800, estimate: true },
      "2026-11-30": { amount: 8000, estimate: true },
    });
  });
});

describe("contributions", () => {
  it("rounds SSS salary credit to the nearest ₱500 within limits", () => {
    expect(sssSalaryCredit(3000)).toBe(5000);
    expect(sssSalaryCredit(17599)).toBe(17500);
    expect(sssSalaryCredit(17750)).toBe(18000);
    expect(sssSalaryCredit(90000)).toBe(35000);
    expect(sssContribution(17600)).toBe(2625);
  });

  it("PhilHealth is 5% within the floor and ceiling", () => {
    expect(philhealthContribution(8000)).toBe(500);
    expect(philhealthContribution(17600)).toBe(880);
    expect(philhealthContribution(150000)).toBe(5000);
  });

  it("Pag-IBIG is both shares, up to ₱400", () => {
    expect(pagibigContribution(17600)).toBe(400);
    expect(pagibigContribution(1200)).toBe(36);
  });

  it("only lists the ones you pay", () => {
    // ₱800 × 22 = ₱17,600 a month.
    expect(contributions({ ...settings, payPagibig: false })).toEqual([
      { key: "sss", name: "SSS contribution", amount: 2625, custom: false },
      { key: "philhealth", name: "PhilHealth contribution", amount: 880, custom: false },
    ]);
  });

  it("uses the amounts you entered over the calculated ones", () => {
    expect(contributions({ ...settings, sssAmount: 1125, pagibigAmount: 200 })).toEqual([
      { key: "sss", name: "SSS contribution", amount: 1125, custom: true },
      { key: "philhealth", name: "PhilHealth contribution", amount: 880, custom: false },
      { key: "pagibig", name: "Pag-IBIG contribution", amount: 200, custom: true },
    ]);
    // Turned off still means off.
    expect(contributions({ ...settings, sssAmount: 1125, paySss: false }).map((c) => c.key)).toEqual(["philhealth", "pagibig"]);
  });
});

describe("8% income tax", () => {
  it("taxes gross above ₱250,000", () => {
    expect(taxOnGross(200000)).toBe(0);
    expect(taxOnGross(300000)).toBe(4000);
  });

  it("splits the year's tax across quarters", () => {
    // ₱1,500 a day: about ₱390k a year, so tax starts in Q3.
    const records: PayrollRecords = { settings: { ...settings, dailyRate: 1500 }, days: [], overtime: [] };
    const q = taxPayments(records, 2026, "2026-01-01");
    expect(q.map((t) => t.key)).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
    expect(q[0].amount).toBe(0);
    expect(q[1].amount).toBe(0);
    expect(q[2].amount).toBeGreaterThan(0);
    const total = q.reduce((sum, t) => sum + t.amount, 0);
    expect(total).toBeCloseTo(taxOnGross(q[3].grossToDate), 2);
    expect(q[3].dueOn).toBe("2027-04-15");
  });

  it("lists the next four due dates", () => {
    const records: PayrollRecords = { settings, days: [], overtime: [] };
    expect(upcomingTaxPayments(records, "2026-11-04").map((t) => t.dueOn)).toEqual([
      "2026-11-15",
      "2027-04-15",
      "2027-05-15",
      "2027-08-15",
    ]);
  });
});

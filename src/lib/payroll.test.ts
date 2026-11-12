import { describe, expect, it } from "vitest";
import type { Period } from "@/lib/dates";
import {
  KINSENA,
  changeFor,
  contributions,
  cutoffContaining,
  cutoffDaysText,
  cutoffChangeProblem,
  cutoffRuleOf,
  cutoffRuleText,
  cutoffsPaidOn,
  pageRule,
  typicalCutoffPay,
  usualFor,
  formatCutoff,
  isCutoffDays,
  nextCutoff,
  previousCutoff,
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
  rateOf,
  sameRate,
  settingsFor,
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

describe("pay that changes from a cutoff", () => {
  // ₱800 a day until a raise to ₱1,000 from the Nov 16 cutoff.
  const records: PayrollRecords = {
    settings,
    days: [],
    overtime: [],
    changes: [{ from: "2026-11-16", dailyRate: 1000, hoursPerDay: 8, startTime: "08:30", overtimeRate: 1.25 }],
  };

  it("uses the old pay before the change and the new one from it", () => {
    expect(settingsFor(records, "2026-11-15").dailyRate).toBe(800);
    expect(settingsFor(records, "2026-11-16")).toMatchObject({ dailyRate: 1000, startTime: "08:30", overtimeRate: 1.25 });
    expect(settingsFor(records, "2027-03-02").dailyRate).toBe(1000);
    // The rest is the same for every cutoff.
    expect(settingsFor(records, "2026-11-20").paySss).toBe(true);
  });

  it("works out each cutoff with its own pay", () => {
    // Nov 1–15 and Nov 16–30, 2026: 10 and 11 weekdays.
    expect(payForCutoff(records, NOV_1, "2026-12-01").total).toBe(8000);
    expect(payForCutoff(records, { start: "2026-11-16", end: "2026-11-30" }, "2026-12-01").total).toBe(11000);
  });

  it("takes the latest change on or before the cutoff", () => {
    const two: PayrollRecords = {
      ...records,
      changes: [
        { from: "2027-01-01", dailyRate: 1200, hoursPerDay: 8, startTime: "08:00", overtimeRate: 1 },
        ...records.changes!,
      ],
    };
    expect(changeFor(two, "2026-12-31")?.from).toBe("2026-11-16");
    expect(changeFor(two, "2027-01-15")?.dailyRate).toBe(1200);
    expect(changeFor(two, "2026-11-01")).toBeNull();
  });

  it("tells when two rates are the same", () => {
    const noSss: PayrollSettings = { ...settings, paySss: false };
    expect(sameRate(rateOf(settings), rateOf(noSss))).toBe(true);
    expect(sameRate(rateOf(settings), records.changes![0])).toBe(false);
  });
});

describe("your own cutoff days: 3–17 and 18–2", () => {
  const days = [3, 18] as const;
  const paydays = { frequency: "twice_monthly" as const, day1: 15, day2: 30 };

  it("finds the cutoff a day is in, across months", () => {
    expect(cutoffContaining("2026-11-11", days)).toEqual({ start: "2026-11-03", end: "2026-11-17" });
    expect(cutoffContaining("2026-11-18", days)).toEqual({ start: "2026-11-18", end: "2026-12-02" });
    expect(cutoffContaining("2026-11-02", days)).toEqual({ start: "2026-10-18", end: "2026-11-02" });
    expect(cutoffContaining("2027-01-01", days)).toEqual({ start: "2026-12-18", end: "2027-01-02" });
    expect(cutoffContaining("2027-02-20", days)).toEqual({ start: "2027-02-18", end: "2027-03-02" });
  });

  it("keeps 1–15 and 16–end by default", () => {
    expect(cutoffContaining("2026-11-20")).toEqual({ start: "2026-11-16", end: "2026-11-30" });
    expect(cutoffContaining("2027-02-03")).toEqual({ start: "2027-02-01", end: "2027-02-15" });
    expect(cutoffFor("2026-11-30")).toEqual(NOV_1);
  });

  it("pays each on the first payday after it ends", () => {
    expect(paydayFor({ start: "2026-11-03", end: "2026-11-17" }, paydays)).toBe("2026-11-30");
    expect(paydayFor({ start: "2026-11-18", end: "2026-12-02" }, paydays)).toBe("2026-12-15");
    expect(cutoffFor("2026-11-30", days)).toEqual({ start: "2026-11-03", end: "2026-11-17" });
    expect(cutoffFor("2026-12-15", days)).toEqual({ start: "2026-11-18", end: "2026-12-02" });
  });

  it("steps and labels cutoffs", () => {
    const nov18 = { start: "2026-11-18", end: "2026-12-02" };
    expect(nextCutoff(nov18, days).start).toBe("2026-12-03");
    expect(previousCutoff(nov18, days).start).toBe("2026-11-03");
    expect(formatCutoff(nov18, "2026-11-11")).toBe("Nov 18 – Dec 2");
    expect(formatCutoff({ start: "2026-11-03", end: "2026-11-17" }, "2026-11-11")).toBe("Nov 3 – 17");
    expect(cutoffDaysText(days)).toBe("3–17 and 18–2");
    expect(cutoffDaysText(KINSENA)).toBe("1–15 and 16–end");
  });

  it("works out a payday from its own cutoff", () => {
    const records: PayrollRecords = { settings: { ...settings, cutoffDays: days }, days: [], overtime: [] };
    // Nov 3–17, 2026: 11 weekdays at ₱800.
    expect(paydayAmounts(records, paydays, "2026-11-30", "2026-12-01", "2026-11-11")["2026-11-30"].amount).toBe(8800);
    // Pay changes start with your cutoffs too.
    const raised = { ...records, changes: [{ from: "2026-11-18", dailyRate: 1000, hoursPerDay: 8, startTime: "08:00", overtimeRate: 1 }] };
    expect(settingsFor(raised, "2026-11-17").dailyRate).toBe(800);
    expect(settingsFor(raised, "2026-12-01").dailyRate).toBe(1000);
  });

  it("only accepts two different days from 1 to 28", () => {
    expect(isCutoffDays([3, 18])).toBe(true);
    expect(isCutoffDays([18, 3])).toBe(false);
    expect(isCutoffDays([3, 30])).toBe(false);
    expect(isCutoffDays([5, 5])).toBe(false);
  });
});

describe("cutoffs that follow your payday", () => {
  const weekly: PayrollRecords = { settings: { ...settings, frequency: "weekly" }, days: [], overtime: [] };
  const monthly: PayrollRecords = { settings: { ...settings, frequency: "monthly" }, days: [], overtime: [] };
  const fridays = { frequency: "weekly" as const, day1: 5, day2: null };

  it("makes weekly cutoffs from the day your week starts", () => {
    expect(cutoffRuleOf(weekly.settings)).toEqual({ every: "week", weekday: 1 });
    expect(cutoffContaining("2026-11-12", cutoffRuleOf(weekly.settings))).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    const fromSaturday = cutoffRuleOf({ ...weekly.settings, cutoffWeekday: 6 });
    expect(cutoffContaining("2026-11-12", fromSaturday)).toEqual({ start: "2026-11-07", end: "2026-11-13" });
    expect(cutoffRuleText(fromSaturday)).toBe("Saturday to Friday");
    expect(typicalCutoffPay(weekly.settings)).toBe(4000);
  });

  it("makes monthly cutoffs from the day your month starts", () => {
    expect(cutoffContaining("2026-11-12", cutoffRuleOf(monthly.settings))).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    const fromFifth = cutoffRuleOf({ ...monthly.settings, cutoffMonthDay: 5 });
    expect(cutoffContaining("2026-11-03", fromFifth)).toEqual({ start: "2026-10-05", end: "2026-11-04" });
    expect(cutoffRuleText(fromFifth)).toBe("the 5th to the 4th of the next month");
    expect(typicalCutoffPay(monthly.settings)).toBe(17600);
  });

  it("pays each Friday for the week before", () => {
    // Nov 13 pays Mon Nov 2 – Sun Nov 8: 5 weekdays.
    expect(cutoffsPaidOn("2026-11-13", fridays, cutoffRuleOf(weekly.settings))).toEqual([{ start: "2026-11-02", end: "2026-11-08" }]);
    expect(paydayAmounts(weekly, fridays, "2026-11-13", "2026-11-14", "2026-11-12")["2026-11-13"].amount).toBe(4000);
  });

  it("pays two weeks when only every other Friday pays", () => {
    const firstAndThird = { ...fridays, weeks: [1, 3] };
    expect(cutoffsPaidOn("2026-11-20", firstAndThird, cutoffRuleOf(weekly.settings))).toEqual([
      { start: "2026-11-02", end: "2026-11-08" },
      { start: "2026-11-09", end: "2026-11-15" },
    ]);
    expect(paydayAmounts(weekly, firstAndThird, "2026-11-20", "2026-11-21", "2026-11-12")["2026-11-20"].amount).toBe(8000);
  });

  it("pays monthly for the month before", () => {
    // Oct 2026 has 22 weekdays.
    const on15th = { frequency: "monthly" as const, day1: 15, day2: null };
    expect(paydayAmounts(monthly, on15th, "2026-11-15", "2026-11-16", "2026-11-12")["2026-11-15"].amount).toBe(17600);
  });

  it("counts every weekly cutoff of the year once for tax", () => {
    // 52 weeks start on a Monday in 2026, 5 days each.
    const annual = taxPayments(weekly, 2026, "2026-11-12").at(-1)!;
    expect(annual.grossToDate).toBe(52 * 4000);
  });
});

describe("your own setup: per day, paid the 15th and 30th, cutoffs 3–17 and 18–2", () => {
  const rate = { ...settings, dailyRate: 900.36, cutoffDays: [3, 18] as const };
  const paydays = { frequency: "twice_monthly" as const, day1: 15, day2: 30 };
  const records: PayrollRecords = { settings: rate, days: [], overtime: [] };

  it("pays 3–17 on the 30th and 18–2 on the 15th", () => {
    const amounts = paydayAmounts(records, paydays, "2026-11-15", "2026-12-16", "2026-11-13");
    expect(amounts["2026-11-15"].amount).toBe(9903.96); // Oct 18 – Nov 2: 11 days
    expect(amounts["2026-11-30"].amount).toBe(9903.96); // Nov 3 – 17: 11 days
    expect(amounts["2026-12-15"].amount).toBe(9903.96); // Nov 18 – Dec 2: 11 days
  });

  it("moves the next cutoff to meet one that ended early", () => {
    const moved = { ...rate, cutoffChanges: [{ usual: "2026-11-03", start: "2026-11-03", end: "2026-11-16", paidOn: null }] };
    const rule = cutoffRuleOf(moved);
    expect(cutoffContaining("2026-11-10", rule)).toEqual({ start: "2026-11-03", end: "2026-11-16" });
    expect(cutoffContaining("2026-11-17", rule)).toEqual({ start: "2026-11-17", end: "2026-12-02" });
    expect(previousCutoff({ start: "2026-11-03", end: "2026-11-16" }, rule)).toEqual({ start: "2026-10-18", end: "2026-11-02" });
    // After that, back to the usual 3–17.
    expect(cutoffContaining("2026-12-10", rule)).toEqual({ start: "2026-12-03", end: "2026-12-17" });
    expect(usualFor({ start: "2026-11-17", end: "2026-12-02" }, rule)).toEqual({ start: "2026-11-18", end: "2026-12-02" });
    const amounts = paydayAmounts({ ...records, settings: moved }, paydays, "2026-11-30", "2026-12-16", "2026-11-13");
    expect(amounts["2026-11-30"].amount).toBe(9003.6); // 10 days
    expect(amounts["2026-12-15"].amount).toBe(10804.32); // Nov 17 – Dec 2: 12 days
  });

  it("pays a cutoff on the day its payday moved to", () => {
    const moved = { ...rate, cutoffChanges: [{ usual: "2026-11-03", start: "2026-11-03", end: "2026-11-17", paidOn: "2026-11-27" }] };
    const amounts = paydayAmounts({ ...records, settings: moved }, paydays, "2026-11-30", "2026-12-01", "2026-11-13");
    expect(amounts["2026-11-30"]).toEqual({ amount: 9903.96, estimate: true, paidOn: "2026-11-27" });
    expect(paydayFor({ start: "2026-11-03", end: "2026-11-17" }, paydays, cutoffRuleOf(moved))).toBe("2026-11-27");
  });

  it("turns away a change that leaves a neighbour no days", () => {
    const rule = cutoffRuleOf(rate);
    const change = (start: string, end: string) => ({ usual: "2026-11-03", start, end, paidOn: null });
    expect(cutoffChangeProblem(change("2026-11-03", "2026-11-16"), rule, "2026-11-13")).toBeNull();
    expect(cutoffChangeProblem(change("2026-11-03", "2026-12-02"), rule, "2026-11-13")).toMatch(/after needs a day/);
    expect(cutoffChangeProblem(change("2026-10-18", "2026-11-17"), rule, "2026-11-13")).toMatch(/before needs a day/);
    expect(cutoffChangeProblem(change("2026-11-04", "2026-11-03"), rule, "2026-11-13")).toMatch(/can't end before/);
  });
});

describe("a monthly rate, and weekends", () => {
  const monthly: PayrollSettings = { ...settings, dailyRate: 900.36, monthlyPay: 19808 };
  const nov1: Period = { start: "2026-11-01", end: "2026-11-15" };

  it("pays half of it twice a month, less each work day missed", () => {
    const days = daysFor(nov1, new Map(), null, monthly).map((d) =>
      d.date === "2026-11-05" ? { ...d, status: "leave" as const, leaveType: "sick" as const } : d,
    );
    const pay = cutoffPay(monthly, days, [], 0.5);
    expect(pay.basePay).toBe(9904);
    expect(pay.missedDays).toBe(1);
    expect(pay.total).toBe(9003.64);
    expect(typicalCutoffPay({ ...monthly, frequency: "twice_monthly" })).toBe(9904);
  });

  it("counts a regular Saturday as a work day", () => {
    const withSaturdays = { ...settings, dailyRate: 900.36, saturday: "regular" as const };
    const pay = cutoffPay(withSaturdays, daysFor(nov1, new Map(), null, withSaturdays), []);
    // Nov 2–6, 7, 9–13, 14: 12 days.
    expect(pay.workedDays).toBe(12);
    expect(pay.basePay).toBe(10804.32);
  });

  it("pays an overtime Saturday only for its hours", () => {
    const overtimeSaturdays = { ...settings, dailyRate: 900.36, overtimeRate: 1.25, saturday: "overtime" as const };
    const days = daysFor(nov1, new Map(), null, overtimeSaturdays).map((d) =>
      d.date === "2026-11-07" ? { ...d, status: "worked" as const } : d,
    );
    const pay = cutoffPay(overtimeSaturdays, days, [{ date: "2026-11-07", start: "08:00", end: "12:00" }]);
    expect(pay.workedDays).toBe(10);
    expect(pay.overtimePay).toBe(562.73);
  });
});

describe("paid every work day", () => {
  const daily: PayrollRecords = { settings: { ...settings, dailyRate: 900.36, frequency: "daily" }, days: [], overtime: [] };
  const weekdays = { frequency: "daily" as const, day1: 1, day2: null, weekdays: [1, 2, 3, 4, 5] };

  it("pays each day on that day, and the weekend with Monday", () => {
    const rule = cutoffRuleOf(daily.settings);
    expect(cutoffsPaidOn("2026-11-17", weekdays, rule)).toEqual([{ start: "2026-11-17", end: "2026-11-17" }]);
    expect(cutoffsPaidOn("2026-11-16", weekdays, rule).map((c) => c.start)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16"]);
    const amounts = paydayAmounts(daily, weekdays, "2026-11-16", "2026-11-21", "2026-11-13");
    expect(Object.values(amounts).map((a) => a.amount)).toEqual([900.36, 900.36, 900.36, 900.36, 900.36]);
    expect(typicalCutoffPay(daily.settings)).toBe(900.36);
  });

  it("shows and saves a week at a time", () => {
    expect(cutoffContaining("2026-11-18", pageRule(cutoffRuleOf(daily.settings)))).toEqual({ start: "2026-11-16", end: "2026-11-22" });
  });
});

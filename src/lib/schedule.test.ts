import { describe, expect, it } from "vitest";
import {
  amountOn,
  describeSchedule,
  isValidSchedule,
  nextOccurrence,
  occurrences,
  payPerMonth,
  previousOccurrence,
  slotOf,
  weekOfMonth,
  type Schedule,
} from "@/lib/schedule";

// Fridays in November 2026: the 6th, 13th, 20th and 27th. Oct 30 is a 5th Friday.
const FRIDAYS: Schedule = { frequency: "weekly", day1: 5, day2: null };

describe("weekly paydays", () => {
  it("falls on every Friday by default", () => {
    expect(occurrences(FRIDAYS, "2026-11-01", "2026-12-01")).toEqual(["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  });

  it("only falls in the weeks of the month you pick", () => {
    const firstAndThird = { ...FRIDAYS, weeks: [1, 3] };
    expect(occurrences(firstAndThird, "2026-10-01", "2026-12-01")).toEqual(["2026-10-02", "2026-10-16", "2026-11-06", "2026-11-20"]);
    expect(nextOccurrence(firstAndThird, "2026-11-06")).toBe("2026-11-20");
    expect(nextOccurrence(firstAndThird, "2026-11-20")).toBe("2026-12-04");
    expect(previousOccurrence(firstAndThird, "2026-11-20")).toBe("2026-11-06");
    expect(describeSchedule(firstAndThird)).toBe("1st & 3rd Friday");
    expect(describeSchedule({ ...FRIDAYS, weeks: [1, 2, 3, 4, 5] })).toBe("Every Friday");
  });

  it("finds the next 5th Friday even months away", () => {
    // Saved before 5th-only paydays were turned away: Home must still find the next one.
    const fifthOnly = { ...FRIDAYS, weeks: [5] };
    expect(nextOccurrence(fifthOnly, "2026-11-12")).toBe("2027-01-29");
    expect(previousOccurrence(fifthOnly, "2027-01-29")).toBe("2026-10-30");
    expect(isValidSchedule(fifthOnly)).toBe(false);
    expect(isValidSchedule({ ...FRIDAYS, weeks: [4, 5] })).toBe(true);
  });

  it("puts each date in its week of the month", () => {
    expect(weekOfMonth("2026-11-06")).toBe(1);
    expect(weekOfMonth("2026-11-07")).toBe(1);
    expect(weekOfMonth("2026-11-08")).toBe(2);
    expect(weekOfMonth("2026-10-30")).toBe(5);
  });
});

describe("an amount for each payday", () => {
  it("uses each week's own amount, or the payday's for a blank one", () => {
    const weekly = { ...FRIDAYS, amounts: [3000, 2500, null, 4000, 1000], amount: 2000 };
    expect(slotOf(weekly, "2026-11-13")).toBe(1);
    expect(amountOn(weekly, "2026-11-06")).toBe(3000);
    expect(amountOn(weekly, "2026-11-13")).toBe(2500);
    expect(amountOn(weekly, "2026-11-20")).toBe(2000);
    expect(amountOn(weekly, "2026-10-30")).toBe(1000);
  });

  it("uses each of two days' own amount, the last day of a short month too", () => {
    const twice = { frequency: "twice_monthly" as const, day1: 15, day2: 30, amounts: [8000, 9500], amount: 8750 };
    expect(amountOn(twice, "2026-11-15")).toBe(8000);
    expect(amountOn(twice, "2026-11-30")).toBe(9500);
    expect(amountOn(twice, "2027-02-28")).toBe(9500);
    // A day of the month that's the same as day2 in February (Feb 28 for the 28th & 30th).
    expect(amountOn({ ...twice, day1: 28 }, "2027-02-28")).toBe(8000);
  });

  it("adds up a typical month", () => {
    expect(payPerMonth({ frequency: "twice_monthly", day1: 15, day2: 30, amounts: [8000, 9500], amount: 8750 })).toBe(17500);
    expect(payPerMonth({ frequency: "monthly", day1: 30, day2: null, amount: 20000 })).toBe(20000);
    // Weeks 1–4 every month, the 5th about a third of the time.
    expect(payPerMonth({ ...FRIDAYS, amounts: [1000, 1000, 1000, 1000, 3000], amount: null })).toBe(5000);
    expect(payPerMonth({ ...FRIDAYS, weeks: [1, 3], amounts: [1000, null, 2000, null, null], amount: null })).toBe(3000);
    expect(payPerMonth({ ...FRIDAYS, amounts: [1000, null, 1000, 1000, 1000], amount: null })).toBeNull();
  });

  it("checks the amounts match the schedule", () => {
    expect(isValidSchedule({ ...FRIDAYS, weeks: [1, 3], amounts: [1, null, 2, null, null] })).toBe(true);
    expect(isValidSchedule({ ...FRIDAYS, amounts: [1, 2] })).toBe(false);
    expect(isValidSchedule({ ...FRIDAYS, weeks: [] })).toBe(false);
    expect(isValidSchedule({ ...FRIDAYS, weeks: [3, 1] })).toBe(false);
    expect(isValidSchedule({ frequency: "monthly", day1: 30, day2: null, weeks: [1] })).toBe(false);
    expect(isValidSchedule({ frequency: "twice_monthly", day1: 15, day2: 30, amounts: [0, 100] })).toBe(false);
  });
});

describe("paid every work day", () => {
  const weekdays: Schedule = { frequency: "daily", day1: 1, day2: null, weekdays: [1, 2, 3, 4, 5] };

  it("falls on the days you're paid", () => {
    expect(occurrences(weekdays, "2026-11-13", "2026-11-18")).toEqual(["2026-11-13", "2026-11-16", "2026-11-17"]);
    expect(nextOccurrence(weekdays, "2026-11-13")).toBe("2026-11-16");
    expect(describeSchedule(weekdays)).toBe("Every work day, Mon–Fri");
    expect(describeSchedule({ ...weekdays, weekdays: [1, 3, 5] })).toBe("Every work day, Mon, Wed & Fri");
    expect(describeSchedule({ ...weekdays, weekdays: null })).toBe("Every day");
    expect(payPerMonth({ ...weekdays, amount: 900 })).toBe(19500);
    expect(isValidSchedule(weekdays)).toBe(true);
    expect(isValidSchedule({ ...weekdays, weekdays: [] })).toBe(false);
    expect(isValidSchedule({ ...weekdays, amounts: [1] })).toBe(false);
  });
});

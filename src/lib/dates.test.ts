import { describe, expect, it } from "vitest";
import { clockOf, formatClock, isValidClock, transactionTime } from "@/lib/dates";

describe("time of day", () => {
  it("reads the clock in Philippine time", () => {
    // 07:42 UTC is 3:42 PM in Manila (UTC+8), and 16:30 UTC is past midnight there.
    expect(clockOf("2026-11-05T07:42:10Z")).toBe("15:42");
    expect(clockOf(new Date("2026-11-05T16:30:00Z"))).toBe("00:30");
  });

  it("shows a 24-hour clock as AM / PM", () => {
    expect(formatClock("15:42")).toBe("3:42 PM");
    expect(formatClock("00:05")).toBe("12:05 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("09:30")).toBe("9:30 AM");
  });

  it("accepts only HH:MM", () => {
    expect(isValidClock("23:59")).toBe(true);
    expect(isValidClock("24:00")).toBe(false);
    expect(isValidClock("9:30")).toBe(false);
    expect(isValidClock("")).toBe(false);
    expect(isValidClock(null)).toBe(false);
  });

  it("uses the picked time, else when it was logged", () => {
    expect(transactionTime({ occurredTime: "08:15", createdAt: "2026-11-05T07:42:00Z" })).toBe(
      "8:15 AM",
    );
    expect(transactionTime({ occurredTime: null, createdAt: "2026-11-05T07:42:00Z" })).toBe(
      "3:42 PM",
    );
    expect(transactionTime({ occurredTime: null, createdAt: null })).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { clampDays, dailySafe, leftover, pesos, pongFor } from "./daily";

describe("Try it: daily amount", () => {
  it("sets aside bills and savings first", () => {
    expect(leftover(12000, 4500, 1000)).toBe(6500);
    expect(leftover(5000, 6000, 0)).toBe(-1000);
  });

  it("splits what's left of the sweldo over the days to payday", () => {
    // (12,000 − 4,500 − 1,000) ÷ 15 = 433.33…, rounded down.
    expect(dailySafe(12000, 4500, 1000, 15)).toBe(433);
  });

  it("goes below zero when bills are bigger than the sweldo", () => {
    expect(dailySafe(5000, 6000, 0, 10)).toBe(-100);
  });

  it("reads blank, junk and negative entries as 0", () => {
    expect(pesos("")).toBe(0);
    expect(pesos("abc")).toBe(0);
    expect(pesos("-50")).toBe(0);
    expect(pesos("₱12,000")).toBe(12000);
  });

  it("keeps days between 1 and 31", () => {
    expect(clampDays(0)).toBe(1);
    expect(clampDays(-3)).toBe(1);
    expect(clampDays(45)).toBe(31);
    expect(clampDays(Number.NaN)).toBe(1);
    expect(dailySafe(300, 0, 0, 0)).toBe(300);
  });

  it("gives Pong a face to match", () => {
    expect(pongFor(500).mood).toBe("proud");
    expect(pongFor(499).mood).toBe("happy");
    expect(pongFor(200).mood).toBe("happy");
    expect(pongFor(199).mood).toBe("worried");
    expect(pongFor(1).mood).toBe("worried");
    expect(pongFor(0).mood).toBe("shocked");
    expect(pongFor(-100).mood).toBe("shocked");
  });
});

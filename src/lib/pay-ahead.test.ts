import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import type { ForecastItem } from "@/lib/forecast";
import {
  aheadCandidates,
  checkDay,
  cleanLocks,
  firstSafeDay,
  monthGrid,
  parseLocks,
  planWithLocks,
  shiftMonth,
  withLocks,
} from "@/lib/pay-ahead";

const today = "2026-11-15";
const day = (n: number) => addDays(today, n);

function item(
  key: string,
  kind: ForecastItem["kind"],
  dueIn: number,
  amount: number,
  extra: Partial<ForecastItem> = {},
): ForecastItem {
  return {
    key,
    kind,
    flow: amount < 0 ? "out" : "in",
    id: key,
    name: key,
    amount: Math.abs(amount),
    dueOn: day(dueIn),
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
    ...extra,
  };
}

// ₱9,000 now, rent on day 5, pay on days 10 and 40, three loan payments.
// The plan comes to ₱120 a day, so before pay on day 10 it bottoms out at
// ₱3,800 on day 9.
const items = [
  item("rent", "bill", 5, -3000),
  item("pay", "payday", 10, 6000),
  item("pay2", "payday", 40, 6000),
  item("A", "installment", 7, -1000),
  item("B", "installment", 15, -2000),
  item("C", "installment", 20, -2500),
];
const [, , , A, B, C] = items;
const planOf = (locks: Record<string, string>) =>
  planWithLocks({ start: 9000, items, held: [], locks, today });

describe("aheadCandidates", () => {
  it("keeps unpaid loan payments, bills you pay yourself and utang, due after today", () => {
    const list = [
      ...items,
      item("phone", "bill", 12, -4500, { estimate: true }),
      item("sss", "bill", 12, -750, { fromPayroll: true }),
      item("trip", "planned", 5, -3850),
      item("lourdes", "utang", 17, -1763.88),
      item("lateUtang", "utang", -3, -200),
      item("pautang", "pautang", 6, 500),
      item("paid", "installment", 9, -500, { transactionId: "t1" }),
      item("todays", "installment", 0, -500),
      item("bnpl", "installment", 12, -500, { lenderId: "atome" }),
      item("onCard", "bill", 12, -500, { lenderId: "atome" }),
    ];
    // Rent here is a bill you pay yourself too.
    expect(aheadCandidates(list, new Set(["atome"]), today).map((i) => i.key)).toEqual([
      "rent",
      "A",
      "B",
      "C",
      "phone",
      "lourdes",
    ]);
  });
});

describe("locks", () => {
  it("reads only valid dates, and nothing from broken storage", () => {
    expect(parseLocks(JSON.stringify({ A: day(1), B: "soon", C: 3 }))).toEqual({ A: day(1) });
    expect(parseLocks("{")).toEqual({});
    expect(parseLocks("[1]")).toEqual({});
    expect(parseLocks(null)).toEqual({});
  });

  it("drops locks for paid payments, past days and days on or after the due date", () => {
    expect(
      cleanLocks({ A: today, B: day(-1), C: day(20), gone: day(2) }, [A, B, C], today),
    ).toEqual({ A: today });
  });

  it("moves a locked payment to its day", () => {
    expect(withLocks([A, B], { A: today }).map((i) => i.dueOn)).toEqual([today, B.dueOn]);
  });
});

describe("checkDay", () => {
  it("is safe today for each loan on its own", () => {
    const plan = planOf({});
    expect(plan.perDay).toBe(120);
    // Paying B today takes ₱2,000 off every day until day 15: ₱3,800 − ₱2,000 on day 9.
    expect(checkDay(B, today, plan, {}, today)).toEqual({ safe: true, low: 1800, lowOn: day(9) });
    expect(checkDay(C, today, plan, {}, today)).toEqual({ safe: true, low: 1300, lowOn: day(9) });
  });

  it("isn't safe once other locks take the room", () => {
    const locks = { A: today, B: today };
    const plan = planOf(locks);
    // ₱1,800 on day 9 after A and B, minus C's ₱2,500.
    expect(checkDay(C, today, plan, locks, today)).toEqual({
      safe: false,
      low: -700,
      lowOn: day(9),
    });
    expect(firstSafeDay(C, plan, locks, today)).toBe(day(10));
  });

  it("counts a locked payment once when checking it again", () => {
    const locks = { A: today, B: today };
    const plan = planOf(locks);
    expect(checkDay(B, today, plan, locks, today)).toEqual({
      safe: true,
      low: 1800,
      lowOn: day(9),
    });
    expect(firstSafeDay(A, plan, locks, today)).toBe(today);
  });

  it("is always safe on the due day", () => {
    expect(checkDay(C, C.dueOn, planOf({}), {}, today)).toEqual({
      safe: true,
      low: null,
      lowOn: null,
    });
  });
});

describe("month view", () => {
  it("starts a month on its weekday, Sunday first", () => {
    // Nov 1, 2026 is a Sunday; Dec 1 a Tuesday.
    expect(monthGrid("2026-11").slice(0, 2)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(monthGrid("2026-11")).toHaveLength(30);
    expect(monthGrid("2026-12").slice(0, 3)).toEqual([null, null, "2026-12-01"]);
    expect(monthGrid("2027-02").at(-1)).toBe("2027-02-28");
  });

  it("steps across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
  });
});

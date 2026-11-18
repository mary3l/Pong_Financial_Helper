import { describe, expect, it } from "vitest";
import {
  dueDate,
  equalShares,
  isOverdue,
  personItems,
  splitEffects,
  type Person,
} from "@/lib/people";

const TODAY = "2026-11-02";

function person(balance: number, entries: Partial<Person["entries"][number]>[] = []): Person {
  return {
    id: "ana",
    name: "Ana",
    contact: null,
    balance,
    entries: entries.map((e, i) => ({
      transactionId: `t${i}`,
      personId: "ana",
      kind: "lend",
      dueOn: null,
      countInForecast: false,
      splitTotal: null,
      ...e,
    })),
  };
}

describe("split bills", () => {
  it("splits evenly; you absorb the rounding", () => {
    const shares = equalShares(1000, ["ana", "ben"]);
    expect(shares).toEqual([
      { personId: null, amount: 333.34 },
      { personId: "ana", amount: 333.33 },
      { personId: "ben", amount: 333.33 },
    ]);
  });

  it("you paid: only your share is spending, the rest is pautang", () => {
    const effects = splitEffects(equalShares(900, ["ana", "ben"]), null);
    expect(effects.expense).toBe(300);
    expect(effects.lent).toEqual([
      { personId: "ana", amount: 300 },
      { personId: "ben", amount: 300 },
    ]);
    expect(effects.owed).toBe(0);
  });

  it("they paid: your share is spending and utang to them", () => {
    const effects = splitEffects(equalShares(900, ["ana", "ben"]), "ben");
    expect(effects).toEqual({ expense: 300, lent: [], owed: 300 });
  });
});

describe("forecast ignores pautang until it's paid back", () => {
  it("leaves pautang out unless you switched on Count it in my forecast", () => {
    expect(personItems([person(1000, [{ dueOn: "2026-11-15" }])], TODAY, "2026-12-02")).toEqual([]);
    const counted = personItems(
      [person(1000, [{ dueOn: "2026-11-15", countInForecast: true }])],
      TODAY,
      "2026-12-02",
    );
    expect(counted).toHaveLength(1);
    expect(counted[0]).toMatchObject({
      kind: "pautang",
      flow: "in",
      amount: 1000,
      dueOn: "2026-11-15",
    });
  });

  it("never counts late pautang", () => {
    const late = person(1000, [{ dueOn: "2026-10-30", countInForecast: true }]);
    expect(personItems([late], TODAY, "2026-12-02")).toEqual([]);
    expect(isOverdue(late, TODAY)).toBe(true);
  });

  it("counts utang with a due date as money going out, late or not", () => {
    const owe = person(-500, [{ kind: "borrow", dueOn: "2026-10-30" }]);
    const items = personItems([owe], TODAY, "2026-12-02");
    expect(items[0]).toMatchObject({ kind: "utang", flow: "out", amount: 500 });
  });

  it("uses the earliest promised date", () => {
    expect(dueDate(person(800, [{ dueOn: "2026-11-30" }, { dueOn: "2026-11-15" }]))).toBe(
      "2026-11-15",
    );
    expect(dueDate(person(0, [{ dueOn: "2026-11-15" }]))).toBeNull();
  });
});

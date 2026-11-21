import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/data";
import { offBill } from "@/lib/off-bill";

const t = (over: Partial<Transaction> & { id: string }): Transaction => ({
  type: "expense",
  amount: 100,
  accountId: "atome",
  toAccountId: null,
  toAmount: null,
  category: "food",
  subcategory: null,
  note: null,
  occurredOn: "2026-11-07",
  createdAt: null,
  occurredTime: null,
  splitId: null,
  ...over,
});

const bill = (sourceTxnId: string | null, principalPart: number, paid = false) => ({
  sourceTxnId,
  payments: [
    {
      id: `p-${sourceTxnId}`,
      planId: "x",
      seq: 1,
      dueOn: "2026-12-16",
      amount: principalPart,
      principalPart,
      feePart: 0,
      transactionId: paid ? "t" : null,
    },
  ],
});

const line = { dueDay: 16, cutoffDay: 6 };
const today = "2026-11-16";

describe("what you owe on no bill", () => {
  // Atome in November 2026: ₱3,951.12 on the Dec 16 bill, a grocery trip and a Maxim ride on none, ₱1 left from October.
  const groceries = t({ id: "g", amount: 808.5, note: "Groceries · Gmall", category: "groceries" });
  const maxim = t({ id: "m", amount: 59, subcategory: "Maxim", category: "transpo" });
  const old = t({ id: "o", amount: 300, occurredOn: "2026-10-02" });

  it("lists the newest purchases what you owe still holds, on the bill each lands on", () => {
    const off = offBill({
      owed: 4819.62,
      plans: [bill("b", 3951.12)],
      splits: new Map(),
      purchases: [groceries, maxim, old],
      line,
      today,
    });
    expect(off.purchases.map((p) => [p.name, p.amount, p.dueOn])).toEqual([
      ["Groceries · Gmall", 808.5, "2026-12-16"],
      ["Maxim", 59, "2026-12-16"],
    ]);
  });

  it("lists nothing when the bills cover what you owe", () => {
    expect(
      offBill({
        owed: 3951.12,
        plans: [bill("b", 3951.12)],
        splits: new Map(),
        purchases: [groceries],
        line,
        today,
      }).purchases,
    ).toEqual([]);
  });

  it("skips purchases already on a bill and split records", () => {
    const split = t({ id: "s", splitId: "s1" });
    const off = offBill({
      owed: 1000,
      plans: [bill("g", 0, true)],
      splits: new Map(),
      purchases: [groceries, split, maxim],
      line,
      today,
    });
    expect(off.purchases.map((p) => p.id)).toEqual(["m"]);
  });

  it("counts splits on no bill first", () => {
    const share = t({ id: "s", amount: 100, splitId: "s1" });
    const pautang = t({
      id: "s2",
      type: "transfer",
      amount: 708.5,
      toAccountId: "toni",
      splitId: "s1",
    });
    const off = offBill({
      owed: 867.5,
      plans: [],
      splits: new Map([["s1", [share, pautang]]]),
      purchases: [maxim, groceries],
      line,
      today,
    });
    expect(off.splits.map((s) => s.total)).toEqual([808.5]);
    expect(off.purchases.map((p) => p.id)).toEqual(["m"]);
  });
  it("leaves out splits already on a bill and lists the rest newest first", () => {
    const older = t({ id: "a", amount: 200, splitId: "s1", occurredOn: "2026-11-01" });
    const newer = t({ id: "b", amount: 150, splitId: "s2", occurredOn: "2026-11-10" });
    const billed = t({ id: "c", amount: 90, splitId: "s3" });
    const plain = t({ id: "d", amount: 40 });
    const off = offBill({
      owed: 1000,
      plans: [bill("c", 90), bill(null, 0)],
      splits: new Map([
        ["s1", [older]],
        ["s2", [newer]],
        ["s3", [billed]],
      ]),
      purchases: [plain],
      line,
      today,
    });
    expect(off.splits.map((s) => s.occurredOn)).toEqual(["2026-11-10", "2026-11-01"]);
    // No note or subcategory: named after its category.
    expect(off.purchases.map((p) => p.name)).toEqual(["Food"]);
  });
});

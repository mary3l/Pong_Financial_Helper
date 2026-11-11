import { describe, expect, it } from "vitest";
import type { ForecastItem } from "@/lib/forecast";
import { onCardBills } from "@/lib/installments";
import { groupByPayee } from "@/lib/pay-periods";

// A card whose statement cuts off on the 10th, with the bill due on the 16th.
const atome = { id: "atome", dueDay: 16, cutoffDay: 10 };

function item(kind: ForecastItem["kind"], dueOn: string, amount: number, accountId: string | null, extra: Partial<ForecastItem> = {}): ForecastItem {
  return { key: `${kind}|${dueOn}|${amount}`, kind, flow: "out", id: `${kind}-${dueOn}`, name: kind, amount, dueOn, accountId, category: null, estimate: false, transactionId: null, ...extra };
}

describe("bought on a credit line", () => {
  it("is due with the card bill its cutoff puts it on, not the day you buy", () => {
    const [mat] = onCardBills([item("planned", "2026-11-16", 1368, "atome", { name: "Yoga Mat and Kettleball" })], [atome]);
    // After the Nov 10 cutoff: the Dec 10 statement, due Dec 16.
    expect(mat).toMatchObject({ boughtOn: "2026-11-16", dueOn: "2026-12-16", lenderId: "atome" });
    const [early] = onCardBills([item("planned", "2026-11-08", 500, "atome")], [atome]);
    expect(early.dueOn).toBe("2026-11-16");
  });

  it("works for repeating bills on the card too", () => {
    const [netflix] = onCardBills([item("bill", "2026-11-20", 549, "atome")], [atome]);
    expect(netflix.dueOn).toBe("2026-12-16");
  });

  it("leaves wallets, paid items, income and lines with no due day alone", () => {
    const keep = [
      item("planned", "2026-11-16", 100, "gcash"),
      item("planned", "2026-11-16", 100, "atome", { transactionId: "t" }),
      item("installment", "2026-11-16", 100, "gcash", { lenderId: "atome" }),
      item("income", "2026-11-16", 100, "atome", { flow: "in" }),
    ];
    expect(onCardBills(keep, [atome])).toEqual(keep);
    const noDue = [item("planned", "2026-11-16", 100, "spay")];
    expect(onCardBills(noDue, [{ id: "spay", dueDay: null, cutoffDay: null }])).toEqual(noDue);
  });

  it("goes with the line's other payments in Bills by payday", () => {
    const items = onCardBills(
      [
        item("installment", "2026-12-16", 7438.24, "gcash", { lenderId: "atome" }),
        item("planned", "2026-11-16", 1368, "atome", { name: "Yoga Mat and Kettleball" }),
      ],
      [atome],
    );
    const groups = groupByPayee(items, (id) => (id === "atome" ? "Atome" : undefined), "2026-11-11");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "Atome", lenderId: "atome", count: 2, total: 8806.24, firstDue: "2026-12-16" });
  });
});

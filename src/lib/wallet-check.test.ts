import { describe, expect, it } from "vitest";
import { walletCheck, type ForecastItem } from "@/lib/forecast";

const TODAY = "2026-11-11";

function item(kind: ForecastItem["kind"], dueOn: string, amount: number, accountId: string | null, flow: "in" | "out" = "out"): ForecastItem {
  return { key: `${kind}|${dueOn}|${amount}`, kind, flow, id: kind, name: kind, amount, dueOn, accountId, category: null, estimate: false, transactionId: null };
}

// GCash has ₱1,180.93; pay lands in it on the 15th, a bill comes out on the 16th.
const items = [
  item("payday", "2026-11-15", 10500, "gcash", "in"),
  item("bill", "2026-11-16", 6302.12, "gcash"),
  item("bill", "2026-11-12", 9999, "maya"),
  item("bill", "2026-11-13", 9999, null),
];

describe("can one wallet pay for it", () => {
  it("checks today against what's in it now", () => {
    const check = walletCheck({ balance: 1180.93, walletId: "gcash", items, purchase: { name: "Shoes", amount: 2000, first: TODAY, months: 1 }, today: TODAY });
    expect(check).toEqual({ date: TODAY, before: 1180.93, after: -819.07 });
  });

  it("counts the pay and bills set to go through it, not other wallets' or unassigned ones", () => {
    const check = walletCheck({ balance: 1180.93, walletId: "gcash", items, purchase: { name: "Shoes", amount: 2000, first: "2026-11-20", months: 1 }, today: TODAY });
    expect(check).toEqual({ date: "2026-11-20", before: 5378.81, after: 3378.81 });
  });

  it("gives the tightest payment of an installment", () => {
    const check = walletCheck({ balance: 1180.93, walletId: "gcash", items, purchase: { name: "Phone", amount: 3000, first: "2026-11-15", months: 3 }, today: TODAY });
    // One pay of ₱10,500 and the ₱6,302.12 bill, then ₱1,000 on Nov 15, Dec 15 and Jan 15: the last is tightest.
    expect(check.date).toBe("2027-01-15");
    expect(check.after).toBe(2378.81);
  });
});

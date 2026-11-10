import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/data";
import { groupSplits, itemDate, newSharesProblem, pageOfItems, readPage, splitNote, unpaidByRecord } from "@/lib/splits";

const t = (over: Partial<Transaction> & { id: string }): Transaction => ({
  type: "transfer",
  amount: 100,
  accountId: "atome",
  toAccountId: "toni",
  toAmount: null,
  category: null,
  subcategory: null,
  note: null,
  occurredOn: "2026-11-04",
  createdAt: null,
  occurredTime: null,
  splitId: null,
  ...over,
});

describe("split bills in lists", () => {
  const mine = t({ id: "m", type: "expense", amount: 121.37, toAccountId: null, category: "food", note: "Chatukchak (my share)", splitId: "s1" });
  const toni = t({ id: "a", amount: 86.37, note: "Split: Chatukchak", splitId: "s1" });
  const aya = t({ id: "b", amount: 91.37, toAccountId: "aya", note: "Split: Chatukchak", splitId: "s1" });
  const coffee = t({ id: "c", type: "expense", amount: 150, toAccountId: null, category: "food" });

  it("folds a split's records into one item where the first one was", () => {
    const items = groupSplits([toni, coffee, aya, mine]);
    expect(items.map((i) => i.kind)).toEqual(["split", "one"]);
    const split = items[0].kind === "split" ? items[0].split : null;
    expect(split?.mine?.id).toBe("m");
    expect(split?.others.map((o) => o.id)).toEqual(["a", "b"]);
    expect(split?.total).toBe(299.11);
    expect(split?.title).toBe("Chatukchak");
    expect(split?.accountId).toBe("atome");
  });

  it("keeps a lone record of a split as a plain row", () => {
    expect(groupSplits([toni, coffee]).map((i) => i.kind)).toEqual(["one", "one"]);
  });

  it("clears a person's oldest pautang first", () => {
    // Newest first: Chatukchak today, lunch last week. Aya paid back ₱100 of ₱243.37.
    const lunch = t({ id: "old", amount: 152, toAccountId: "aya", occurredOn: "2026-10-28" });
    const unpaid = unpaidByRecord([{ id: "aya", balance: 143.37 }], [aya, lunch]);
    expect(unpaid.get("b")).toBe(91.37);
    expect(unpaid.get("old")).toBe(52);
    expect(unpaidByRecord([{ id: "aya", balance: 0 }], [aya]).get("b")).toBe(0);
  });

  it("reads the note from any record, or says Split bill", () => {
    expect(splitNote([toni])).toBe("Chatukchak");
    expect(splitNote([t({ id: "x", note: "Split bill" }), t({ id: "y", type: "expense", note: "My share" })])).toBe("Split bill");
  });
});

describe("pages in Activity", () => {
  // `count` rows on each day, newest day first.
  const list = (...days: [string, number][]) =>
    groupSplits(days.flatMap(([day, count]) => Array.from({ length: count }, (_, i) => t({ id: `${day}-${i}`, occurredOn: day }))));
  const daysOf = (items: ReturnType<typeof list>) => [...new Set(items.map(itemDate))];

  it("keeps each day on one page, starting a new page instead of cutting one", () => {
    const items = list(["2026-11-10", 12], ["2026-11-09", 10], ["2026-11-08", 15], ["2026-11-07", 3]);
    const first = pageOfItems(items, 1);
    expect([first.page, first.pages, first.items.length]).toEqual([1, 2, 22]);
    expect(daysOf(first.items)).toEqual(["2026-11-10", "2026-11-09"]);
    const second = pageOfItems(items, 2);
    expect(daysOf(second.items)).toEqual(["2026-11-08", "2026-11-07"]);
    expect(second.items.length).toBe(18);
  });

  it("cuts only a day longer than a page", () => {
    const items = list(["2026-11-10", 4], ["2026-11-09", 70]);
    const pages = [1, 2, 3, 4].map((n) => pageOfItems(items, n, 30));
    expect(pages[0].pages).toBe(3);
    expect(pages.map((p) => p.items.length)).toEqual([30, 30, 14, 14]);
    expect(daysOf(pages[0].items)).toEqual(["2026-11-10", "2026-11-09"]);
    // Past the end: the last page.
    expect(pages[3].page).toBe(3);
  });

  it("counts a split bill as one row and never splits its records", () => {
    const mine = t({ id: "m", type: "expense", toAccountId: null, splitId: "s", occurredOn: "2026-11-10" });
    const theirs = t({ id: "x", splitId: "s", occurredOn: "2026-11-10" });
    const page = pageOfItems(groupSplits([mine, theirs, t({ id: "c", occurredOn: "2026-11-10" })]), 1, 2);
    expect(page.items.map((i) => i.kind)).toEqual(["split", "one"]);
    expect(page.pages).toBe(1);
  });

  it("reads ?page=, starting at 1", () => {
    expect([readPage("3"), readPage(undefined), readPage("0"), readPage("-2"), readPage("abc"), readPage(["2"])]).toEqual([3, 1, 1, 1, 1, 1]);
    expect(pageOfItems([], 5)).toEqual({ items: [], page: 1, pages: 1 });
  });
});

describe("adding people to a split", () => {
  const onBill = [{ personId: "toni", name: "Toni" }];

  it("lets in someone new or someone not on the bill yet", () => {
    expect(newSharesProblem([{ personId: "aya", name: "Aya", amount: 120 }, { personId: null, name: "Ben", amount: 80 }], onBill)).toBeNull();
  });

  it("needs a name and a share for each", () => {
    expect(newSharesProblem([{ personId: null, name: "  ", amount: 50 }], onBill)).toBe("Pick who to add, or type their name.");
    expect(newSharesProblem([{ personId: null, name: "Ben", amount: 0 }], onBill)).toBe("Enter Ben's share.");
    expect(newSharesProblem([{ personId: null, name: "x".repeat(61), amount: 5 }], onBill)).toBe("Check the name (up to 60 characters).");
  });

  it("won't put anyone on the bill twice, by pick or by typed name", () => {
    expect(newSharesProblem([{ personId: "toni", name: "", amount: 50 }], onBill)).toBe("They are already on this bill.");
    expect(newSharesProblem([{ personId: null, name: " toni ", amount: 50 }], onBill)).toBe("toni is already on this bill.");
    expect(
      newSharesProblem([{ personId: null, name: "Ben", amount: 50 }, { personId: null, name: "ben", amount: 20 }], onBill),
    ).toBe("ben is already on this bill.");
  });
});

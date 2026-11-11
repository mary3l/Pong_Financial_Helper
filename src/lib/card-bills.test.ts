import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/data";
import { breakdownText, cardBills, expectedText, openRecords, type Person } from "@/lib/people";
import { personReceipt } from "@/lib/receipt";

// Sir James's share of McDonalds, bought on your Atome. Atome's statement
// cuts off on the 26th and the bill is due on the 16th.
const TODAY = "2026-11-11";
const atome = { id: "atome", name: "Atome", dueDay: 16, cutoffDay: 26 };

function txn(t: Partial<Transaction> & Pick<Transaction, "id" | "amount" | "occurredOn">): Transaction {
  return {
    type: "transfer",
    accountId: "atome",
    toAccountId: "james",
    toAmount: null,
    category: null,
    subcategory: null,
    note: null,
    createdAt: null,
    occurredTime: null,
    splitId: null,
    ...t,
  };
}

const NONE = { interest: 0, next: null };

describe("which card bill a purchase is on", () => {
  it("goes by the statement cutoff: on or before it this bill, after it the next", () => {
    const records = [
      txn({ id: "before", amount: 179, occurredOn: "2026-10-22" }),
      txn({ id: "on", amount: 100, occurredOn: "2026-10-26" }),
      txn({ id: "after", amount: 100, occurredOn: "2026-10-28" }),
    ];
    const cards = cardBills({ records, lines: [atome], plans: [], splits: new Map(), today: TODAY });
    expect(cards.get("before")).toEqual({ line: "Atome", dueOn: "2026-11-16", expectedOn: "2026-11-14" });
    expect(cards.get("on")?.dueOn).toBe("2026-11-16");
    expect(cards.get("after")).toEqual({ line: "Atome", dueOn: "2026-12-16", expectedOn: "2026-12-14" });
  });

  it("uses the bill a split was added to, found through any record of the split", () => {
    const records = [txn({ id: "theirs", amount: 179, occurredOn: "2026-10-22", splitId: "s1" })];
    const plan = { sourceTxnId: "mine", personId: null, months: 1, payments: [{ dueOn: "2026-12-16", transactionId: null }] };
    const cards = cardBills({ records, lines: [atome], plans: [plan], splits: new Map([["s1", ["mine", "theirs"]]]), today: TODAY });
    expect(cards.get("theirs")?.dueOn).toBe("2026-12-16");
    // Bill already paid: nothing to ask by.
    const paid = { ...plan, payments: [{ dueOn: "2026-11-16", transactionId: "t" }] };
    expect(cardBills({ records, lines: [atome], plans: [paid], splits: new Map([["s1", ["mine", "theirs"]]]), today: TODAY }).size).toBe(0);
  });

  it("leaves out plans they pay in your name and other wallets", () => {
    const records = [txn({ id: "phone", amount: 6000, occurredOn: "2026-10-22" }), txn({ id: "cash", amount: 50, occurredOn: "2026-10-22", accountId: "gcash" })];
    const theirs = { sourceTxnId: "phone", personId: "james", months: 1, payments: [{ dueOn: "2026-11-16", transactionId: null }] };
    expect(cardBills({ records, lines: [atome], plans: [theirs], splits: new Map(), today: TODAY }).size).toBe(0);
  });

  it("asks two days early, without saying the due date", () => {
    const card = { line: "Atome", dueOn: "2026-11-16", expectedOn: "2026-11-14" };
    expect(expectedText(card, TODAY)).toBe("expected on Nov 14");
    expect(expectedText(card, "2026-11-15")).toBe("expected today");
    expect(expectedText(card, "2026-11-17")).toBe("was expected on Nov 14");
  });
});

describe("a breakdown for something bought on your card", () => {
  const james: Person = {
    id: "james",
    name: "Sir James PAMD",
    contact: null,
    balance: 179,
    entries: [{ transactionId: "mcdo", personId: "james", kind: "split", dueOn: null, countInForecast: false, splitTotal: 790 }],
  };
  const history = [txn({ id: "mcdo", amount: 179, note: "Split: McDonalds", occurredOn: "2026-10-22" })];
  const cards = cardBills({ records: history, lines: [atome], plans: [], splits: new Map(), today: TODAY });
  const open = openRecords(james, history, cards);

  it("says it's on your Atome and when you expect it", () => {
    expect(breakdownText({ person: james, open, today: TODAY, myName: "Mabs" })).toBe(
      [
        "Hi Sir James PAMD! Here's the breakdown of what's still open:",
        "",
        "• Oct 22 · McDonalds: ₱179 (your share of ₱790) · on my Atome",
        "",
        "Total: ₱179",
        "Expected on Nov 14",
        "Salamat! - Mabs",
      ].join("\n"),
    );
  });

  it("puts the same on the image", () => {
    const r = personReceipt({ person: james, open, theirs: NONE, today: TODAY, myName: "Mabs" });
    expect(r.sections[0].rows[0].details).toEqual(["Oct 22 · your share of ₱790", "On my Atome"]);
    expect(r.note).toEqual({ text: "Expected on Nov 14", late: false });
  });

  it("gives each row its date when they're on different bills", () => {
    const more = [txn({ id: "grab", amount: 120, note: "Grab", occurredOn: "2026-10-28" }), ...history];
    const two: Person = { ...james, balance: 299, entries: [...james.entries, { ...james.entries[0], transactionId: "grab", kind: "lend", splitTotal: null }] };
    const both = openRecords(two, more, cardBills({ records: more, lines: [atome], plans: [], splits: new Map(), today: TODAY }));
    const r = personReceipt({ person: two, open: both, theirs: NONE, today: TODAY, myName: null });
    expect(r.sections[0].rows.map((row) => row.details.at(-1))).toEqual(["On my Atome · expected on Nov 14", "On my Atome · expected on Dec 14"]);
    expect(r.note?.text).toBe("Expected on Nov 14");
  });

  it("is late once the bill has passed", () => {
    const r = personReceipt({ person: james, open, theirs: NONE, today: "2026-11-17", myName: null });
    expect(r.note).toEqual({ text: "Was expected on Nov 14", late: true });
    expect(r.mood).toBe("worried");
  });
});

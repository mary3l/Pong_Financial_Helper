import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/data";
import { breakdownText, inYourName, isLate, openRecords, type Person } from "@/lib/people";
import { billBreakdownText, toSplitBill } from "@/lib/splits";

const TODAY = "2026-11-09";

function txn(t: Partial<Transaction> & Pick<Transaction, "id" | "type" | "amount" | "accountId" | "occurredOn">): Transaction {
  return {
    toAccountId: null,
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

describe("a person's breakdown", () => {
  // Newest first, like getTransactions.
  const history = [
    txn({ id: "pay", type: "transfer", amount: 150, accountId: "jade", toAccountId: "gcash", note: "Paid me back", occurredOn: "2026-11-05" }),
    txn({ id: "lunch", type: "transfer", amount: 200, accountId: "gcash", toAccountId: "jade", note: "Lunch", occurredOn: "2026-11-02" }),
    txn({ id: "split", type: "transfer", amount: 756.19, accountId: "gcash", toAccountId: "jade", note: "Split: Chatukchak", occurredOn: "2026-10-23" }),
  ];
  const jade: Person = {
    id: "jade",
    name: "Maam Jade",
    contact: null,
    balance: 806.19,
    entries: [
      { transactionId: "pay", personId: "jade", kind: "payment", dueOn: null, countInForecast: false, splitTotal: null },
      { transactionId: "lunch", personId: "jade", kind: "lend", dueOn: "2026-11-15", countInForecast: false, splitTotal: null },
      { transactionId: "split", personId: "jade", kind: "split", dueOn: null, countInForecast: false, splitTotal: 4200 },
    ],
  };

  it("lists what's still open, oldest first; payments clear the oldest first", () => {
    const open = openRecords(jade, history);
    expect(open.map((r) => [r.label, r.amount, r.left])).toEqual([
      ["Chatukchak", 756.19, 606.19],
      ["Lunch", 200, 200],
    ]);
  });

  it("writes a message to send", () => {
    const text = breakdownText({ person: jade, open: openRecords(jade, history), today: TODAY, myName: "Mariel" });
    expect(text).toBe(
      [
        "Hi Maam Jade! Here's the breakdown of what's still open:",
        "",
        "• Oct 23 · Chatukchak: ₱606.19 left of ₱756.19 (your share of ₱4,200)",
        "• Nov 2 · Lunch: ₱200",
        "",
        "Total: ₱806.19",
        "Due Nov 15",
        "Salamat! - Mariel",
      ].join("\n"),
    );
  });

  it("counts the interest they pay a lender in your name in the total", () => {
    const flora: Person = {
      id: "flora",
      name: "Tita Flora",
      contact: null,
      balance: 2400,
      entries: [{ transactionId: "loan", personId: "flora", kind: "lend", dueOn: null, countInForecast: false, splitTotal: null }],
    };
    const loan = [txn({ id: "loan", type: "transfer", amount: 2400, accountId: "mariloan", toAccountId: "flora", note: "MariLoan loan", occurredOn: "2026-10-16" })];
    const text = breakdownText({
      person: flora,
      open: openRecords(flora, loan),
      today: TODAY,
      myName: null,
      extra: ["My MariLoan loan: ₱1,250 due Nov 16 (3 of 4). ₱2,500 left (₱2,400 + ₱100 interest), 2 payments"],
      theirs: { interest: 100, next: { dueOn: "2026-11-16", amount: 1250 } },
    });
    expect(text).toContain("• Oct 16 · MariLoan loan: ₱2,400");
    expect(text).toContain(["Monthly payments:", "• My MariLoan loan: ₱1,250 due Nov 16"].join("\n"));
    expect(text).toContain(["Total: ₱2,500 (₱2,400 + ₱100 interest & fees)", "Next payment: ₱1,250 due Nov 16"].join("\n"));
  });

  it("tracks the interest and next payment on a loan in your name", () => {
    const flora: Person = { id: "flora", name: "Tita Flora", contact: null, balance: 2400, entries: [] };
    const plans = [
      {
        personId: "flora",
        payments: [
          { dueOn: "2026-10-16", amount: 1250, feePart: 50, transactionId: "paid" },
          { dueOn: "2026-11-16", amount: 1250, feePart: 50, transactionId: null },
          { dueOn: "2026-12-16", amount: 1250, feePart: 50, transactionId: null },
        ],
      },
      // Another of hers due the same day: the next payment adds them up.
      { personId: "flora", payments: [{ dueOn: "2026-11-16", amount: 500, feePart: 0, transactionId: null }] },
      { personId: null, payments: [{ dueOn: "2026-11-10", amount: 999, feePart: 9, transactionId: null }] },
    ];
    const theirs = inYourName("flora", plans);
    expect(theirs).toEqual({ interest: 100, next: { dueOn: "2026-11-16", amount: 1750 } });
    expect(isLate(flora, theirs, TODAY)).toBe(false);
    expect(isLate(flora, theirs, "2026-11-17")).toBe(true);
  });

  it("for utang, says what you owe them", () => {
    const ben: Person = {
      id: "ben",
      name: "Ben",
      contact: null,
      balance: -300,
      entries: [{ transactionId: "b", personId: "ben", kind: "borrow", dueOn: null, countInForecast: false, splitTotal: null }],
    };
    const borrowed = [txn({ id: "b", type: "transfer", amount: 300, accountId: "ben", toAccountId: "gcash", note: "Utang", occurredOn: "2026-11-01" })];
    const text = breakdownText({ person: ben, open: openRecords(ben, borrowed), today: TODAY, myName: null });
    expect(text).toContain("Here's what I still owe you:");
    expect(text).toContain("• Nov 1 · Borrowed: ₱300");
    expect(text).toContain("I'll send it soon. Salamat!");
  });
});

describe("a split bill's breakdown", () => {
  it("lists every share and what's still unpaid", () => {
    const records = [
      txn({ id: "me", type: "expense", amount: 600, accountId: "gcash", note: "Chatukchak (my share)", occurredOn: "2026-10-23", splitId: "s" }),
      txn({ id: "a", type: "transfer", amount: 594.19, accountId: "gcash", toAccountId: "jadang", note: "Split: Chatukchak", occurredOn: "2026-10-23", splitId: "s" }),
      txn({ id: "b", type: "transfer", amount: 434.62, accountId: "gcash", toAccountId: "aya", note: "Split: Chatukchak", occurredOn: "2026-10-23", splitId: "s" }),
    ];
    const text = billBreakdownText({
      split: toSplitBill("s", records),
      names: new Map([["jadang", "Ate Jadang"], ["aya", "Maam Aya"]]),
      unpaid: new Map([["a", 594.19], ["b", 0]]),
      dateLabel: "Oct 23",
      myName: "Mariel",
    });
    expect(text).toBe(
      [
        "Chatukchak · Oct 23",
        "Total bill: ₱1,628.81",
        "",
        "• Mariel: ₱600",
        "• Ate Jadang: ₱594.19 · unpaid",
        "• Maam Aya: ₱434.62 · paid ✓",
        "",
        "Still to pay: ₱594.19. Salamat!",
      ].join("\n"),
    );
  });
});

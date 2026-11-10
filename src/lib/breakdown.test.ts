import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/data";
import { breakdownText, dueThisMonth, inYourName, isLate, openRecords, type Person, type TheirPlan } from "@/lib/people";
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

  describe("someone paying a loan in your name", () => {
    // Tita Flora's MariLoan: ₱14,583.35 left, plus ₱5,162.46 interest she pays the lender.
    const NOV_10 = "2026-11-10";
    const flora: Person = {
      id: "flora",
      name: "Tita Flora",
      contact: null,
      balance: 14583.35,
      entries: [{ transactionId: "loan", personId: "flora", kind: "lend", dueOn: "2027-10-12", countInForecast: false, splitTotal: null }],
    };
    const loan = [txn({ id: "loan", type: "transfer", amount: 14583.35, accountId: "mariloan", toAccountId: "flora", note: "MariLoan loan", occurredOn: "2026-10-16" })];
    const theirs = { interest: 5162.46, next: { dueOn: "2026-11-12", amount: 2820.83 } };
    const mariloan: TheirPlan = {
      label: "My MariLoan loan",
      payments: [
        { amount: 2820.83, dueOn: "2026-11-12", which: "2 of 12" },
        { amount: 2820.83, dueOn: "2026-12-12", which: "3 of 12" },
      ],
    };

    it("finds this month's payments, late ones included, and the next one after", () => {
      const atome: TheirPlan = {
        label: "Phone on my Atome",
        payments: [
          { amount: 500, dueOn: "2026-10-28", which: "4 of 6" },
          { amount: 500, dueOn: "2026-11-28", which: "5 of 6" },
        ],
      };
      const month = dueThisMonth([mariloan, atome], NOV_10);
      expect(month.month).toBe("November");
      expect(month.items.map((p) => [p.label, p.dueOn, p.late])).toEqual([
        ["Phone on my Atome", "2026-10-28", true],
        ["My MariLoan loan", "2026-11-12", false],
        ["Phone on my Atome", "2026-11-28", false],
      ]);
      expect(month.total).toBe(3820.83);
      expect(month.late).toBe(500);
      expect(month.next).toMatchObject({ label: "My MariLoan loan", dueOn: "2026-12-12" });
    });

    it("leads with what to pay this month, then the total still open", () => {
      const text = breakdownText({
        person: flora,
        open: openRecords(flora, loan),
        today: NOV_10,
        myName: "Mabs",
        month: dueThisMonth([mariloan], NOV_10),
        theirs,
      });
      expect(text).toBe(
        [
          "Hi Tita Flora! Here's what's due this November:",
          "",
          "• My MariLoan loan: ₱2,820.83 due Nov 12 (2 of 12)",
          "",
          "To pay this month: ₱2,820.83",
          "",
          "Still open in all: ₱19,745.81",
          "• Oct 16 · MariLoan loan: ₱14,583.35",
          "• Interest & fees in the payments left: ₱5,162.46",
          "",
          "Salamat! - Mabs",
        ].join("\n"),
      );
    });

    it("marks late payments, and says when nothing more is due this month", () => {
      const late = breakdownText({
        person: flora,
        open: openRecords(flora, loan),
        today: "2026-11-13",
        myName: null,
        month: dueThisMonth([mariloan], "2026-11-13"),
        theirs,
      });
      expect(late).toContain("• My MariLoan loan: ₱2,820.83 was due Nov 12 (2 of 12), late");
      expect(late).toContain("To pay this month: ₱2,820.83 (₱2,820.83 of it is late)");

      const paid = { ...mariloan, payments: mariloan.payments.slice(1) };
      const text = breakdownText({ person: flora, open: openRecords(flora, loan), today: NOV_10, myName: null, month: dueThisMonth([paid], NOV_10), theirs });
      expect(text).toContain(
        ["Hi Tita Flora! Nothing more to pay this November.", "Next payment: ₱2,820.83 due Dec 12 (3 of 12) · My MariLoan loan"].join("\n"),
      );
      expect(text).toContain("Still open in all: ₱19,745.81");
    });

    it("without this month's bill, still counts the interest in the total", () => {
      const text = breakdownText({ person: flora, open: openRecords(flora, loan), today: NOV_10, myName: null, theirs });
      expect(text).toContain(["Total: ₱19,745.81 (₱14,583.35 + ₱5,162.46 interest & fees)", "Next payment: ₱2,820.83 due Nov 12"].join("\n"));
    });
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

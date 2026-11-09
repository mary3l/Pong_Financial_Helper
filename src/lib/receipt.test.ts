import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/data";
import { openRecords, type Person } from "@/lib/people";
import { billReceipt, personReceipt, planLineText, type PlanLine } from "@/lib/receipt";
import { toSplitBill } from "@/lib/splits";

const TODAY = "2026-11-09";

function txn(t: Partial<Transaction> & Pick<Transaction, "id" | "type" | "amount" | "accountId" | "occurredOn">): Transaction {
  return { toAccountId: null, toAmount: null, category: null, subcategory: null, note: null, createdAt: null, occurredTime: null, splitId: null, ...t };
}

const loan: PlanLine = {
  label: "My MariLoan loan",
  next: { amount: 1350, dueOn: "2026-11-16" },
  which: "3 of 6",
  payments: 4,
  left: 5400,
  principal: 5000,
  interest: 400,
  interestWord: "interest",
};

describe("receipt for a person", () => {
  const flora: Person = {
    id: "f",
    name: "Tita Flora",
    contact: null,
    balance: 5000,
    entries: [{ transactionId: "m", personId: "f", kind: "lend", dueOn: "2027-02-16", countInForecast: false, splitTotal: null }],
  };
  const history = [txn({ id: "m", type: "transfer", amount: 5000, accountId: "mari", toAccountId: "f", note: "MariLoan loan", occurredOn: "2026-10-01" })];

  it("lists what's open, their loans in your name, and the total with interest", () => {
    const r = personReceipt({
      person: flora,
      open: openRecords(flora, history),
      plans: [loan],
      theirs: { interest: 400, next: { dueOn: "2026-11-16", amount: 1350 } },
      today: TODAY,
      myName: "Mariel",
    });
    expect(r.title).toBe("Tita Flora");
    expect(r.sections.map((s) => s.heading)).toEqual(["", "Monthly payments"]);
    expect(r.sections[0].rows[0]).toMatchObject({ label: "MariLoan loan", amount: "₱5,000", details: ["Oct 1"] });
    expect(r.sections[1].rows[0]).toMatchObject({
      label: "My MariLoan loan",
      amount: "₱5,400",
      details: ["Next ₱1,350 due Nov 16 · 3 of 6", "4 payments left · ₱5,000 + ₱400 interest"],
    });
    expect(r.total).toEqual({ label: "Total", amount: "₱5,400", detail: "₱5,000 + ₱400 interest & fees" });
    expect(r.note).toEqual({ text: "Next payment ₱1,350 due Nov 16", late: false });
    expect(r.footer).toBe("Salamat! — Mariel");
    expect([r.mood, r.bubble]).toEqual(["ask", "Pa-remind lang po!"]);
  });

  it("writes the same plan as a line of text", () => {
    expect(planLineText(loan, TODAY)).toBe("My MariLoan loan: ₱1,350 due Nov 16 (3 of 6). ₱5,400 left (₱5,000 + ₱400 interest), 4 payments");
  });
});

describe("receipt for a split bill", () => {
  it("marks each share paid, part paid or not yet", () => {
    const records = [
      txn({ id: "me", type: "expense", amount: 600, accountId: "g", note: "Chatukchak (my share)", occurredOn: "2026-10-23", splitId: "x" }),
      txn({ id: "1", type: "transfer", amount: 594.19, accountId: "g", toAccountId: "j", note: "Split: Chatukchak", occurredOn: "2026-10-23", splitId: "x" }),
      txn({ id: "2", type: "transfer", amount: 434.62, accountId: "g", toAccountId: "a", note: "Split: Chatukchak", occurredOn: "2026-10-23", splitId: "x" }),
      txn({ id: "3", type: "transfer", amount: 756.19, accountId: "g", toAccountId: "d", note: "Split: Chatukchak", occurredOn: "2026-10-23", splitId: "x" }),
    ];
    const r = billReceipt({
      split: toSplitBill("x", records),
      names: new Map([["j", "Ate Jadang"], ["a", "Maam Aya"], ["d", "Maam Jade"]]),
      unpaid: new Map([["1", 594.19], ["2", 0], ["3", 300]]),
      dateLabel: "Oct 23",
      wallet: "GCash",
      myName: "Mariel",
    });
    expect(r.subtitle).toBe("Oct 23 · paid with GCash");
    expect(r.sections[0].rows.map((row) => [row.label, row.amount, row.details[0], row.badge])).toEqual([
      ["Mariel", "₱600", "Paid the bill", undefined],
      ["Ate Jadang", "₱594.19", "Not paid yet", "UNPAID"],
      ["Maam Aya", "₱434.62", "Paid back", "PAID"],
      ["Maam Jade", "₱756.19", "₱456.19 paid so far", "₱300 LEFT"],
    ]);
    expect([r.mood, r.bubble]).toEqual(["happy", "Hatian na tayo!"]);
    expect(r.total).toEqual({ label: "Still to pay", amount: "₱894.19", detail: "Total bill ₱2,385" });
  });
});

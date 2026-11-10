import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/data";
import { dueThisMonth, openRecords, type Person, type TheirPlan } from "@/lib/people";
import { billReceipt, personReceipt } from "@/lib/receipt";
import { toSplitBill } from "@/lib/splits";

const TODAY = "2026-11-10";

function txn(t: Partial<Transaction> & Pick<Transaction, "id" | "type" | "amount" | "accountId" | "occurredOn">): Transaction {
  return { toAccountId: null, toAmount: null, category: null, subcategory: null, note: null, createdAt: null, occurredTime: null, splitId: null, ...t };
}

const mariloan: TheirPlan = {
  label: "My MariLoan loan",
  payments: [
    { amount: 2820.83, dueOn: "2026-11-12", which: "2 of 12" },
    { amount: 2820.83, dueOn: "2026-12-12", which: "3 of 12" },
  ],
};

describe("receipt for a person", () => {
  const flora: Person = {
    id: "f",
    name: "Tita Flora",
    contact: null,
    balance: 14583.35,
    entries: [{ transactionId: "m", personId: "f", kind: "lend", dueOn: "2027-10-12", countInForecast: false, splitTotal: null }],
  };
  const history = [txn({ id: "m", type: "transfer", amount: 14583.35, accountId: "mari", toAccountId: "f", note: "MariLoan loan", occurredOn: "2026-10-01" })];
  const theirs = { interest: 5162.46, next: { dueOn: "2026-11-12", amount: 2820.83 } };

  it("leads with this month's bill, and shows the total still open smaller", () => {
    const r = personReceipt({
      person: flora,
      open: openRecords(flora, history),
      month: dueThisMonth([mariloan], TODAY),
      theirs,
      today: TODAY,
      myName: "Mabs",
    });
    expect([r.kicker, r.title, r.subtitle]).toEqual(["THIS NOVEMBER", "Tita Flora", "As of Nov 10"]);
    expect(r.lead).toEqual({ label: "To pay this month", amount: "₱2,820.83", detail: "Due by Nov 12", late: false });
    expect(r.sections.map((s) => s.heading)).toEqual(["", "Everything still open"]);
    expect(r.sections[0].rows).toEqual([
      { label: "My MariLoan loan", details: ["Due Nov 12 · 2 of 12"], amount: "₱2,820.83", tone: undefined, badge: undefined },
    ]);
    expect(r.sections[1].rows.map((row) => [row.label, row.amount])).toEqual([
      ["MariLoan loan", "₱14,583.35"],
      ["Interest & fees", "₱5,162.46"],
    ]);
    expect(r.total).toEqual({ label: "Total still open", amount: "₱19,745.81", detail: "₱14,583.35 + ₱5,162.46 interest & fees" });
    expect(r.note).toBeNull();
    expect(r.footer).toBe("Salamat! — Mabs");
    expect([r.mood, r.bubble]).toEqual(["ask", "Pa-remind lang po!"]);
  });

  it("marks a late payment", () => {
    const r = personReceipt({
      person: flora,
      open: openRecords(flora, history),
      month: dueThisMonth([mariloan], "2026-11-13"),
      theirs,
      today: "2026-11-13",
      myName: null,
    });
    expect(r.lead).toMatchObject({ amount: "₱2,820.83", detail: "₱2,820.83 of it is late", late: true });
    expect(r.sections[0].rows[0]).toMatchObject({ details: ["Was due Nov 12 · 2 of 12"], tone: "open", badge: "LATE" });
    expect([r.mood, r.bubble]).toEqual(["worried", "Paalala lang po!"]);
  });

  it("shows the next payment when nothing more is due this month", () => {
    const r = personReceipt({
      person: flora,
      open: openRecords(flora, history),
      month: dueThisMonth([{ ...mariloan, payments: mariloan.payments.slice(1) }], TODAY),
      theirs,
      today: TODAY,
      myName: null,
    });
    expect(r.lead).toEqual({ label: "Next payment", amount: "₱2,820.83", detail: "Due Dec 12 · nothing more this November", late: false });
    expect(r.sections.map((s) => s.heading)).toEqual(["Everything still open"]);
  });

  it("without loans in your name, lists what's open and the total", () => {
    const jade: Person = { ...flora, name: "Maam Jade", balance: 5000 };
    const lunch = [txn({ id: "m", type: "transfer", amount: 5000, accountId: "g", toAccountId: "f", note: "Lunch", occurredOn: "2026-10-01" })];
    const r = personReceipt({ person: jade, open: openRecords(jade, lunch), theirs: { interest: 0, next: null }, today: TODAY, myName: "Mariel" });
    expect(r.lead).toBeNull();
    expect(r.kicker).toBe("WHAT'S STILL OPEN");
    expect(r.sections[0].rows[0]).toMatchObject({ label: "Lunch", amount: "₱5,000", details: ["Oct 1"] });
    expect(r.total).toEqual({ label: "Total", amount: "₱5,000", detail: null });
    expect(r.note).toEqual({ text: "Due Oct 12, 2027", late: false });
    expect(r.footer).toBe("Salamat! — Mariel");
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

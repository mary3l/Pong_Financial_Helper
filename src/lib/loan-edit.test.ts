import { describe, expect, it } from "vitest";
import { loanSchedule } from "@/lib/installments";
import { editLoan, type EditedLoan, type SavedPayment } from "@/lib/loan-edit";

const saved = (rows: ReturnType<typeof loanSchedule>, paid = 0): SavedPayment[] =>
  rows.map((r, i) => ({
    seq: r.seq,
    principalPart: r.principalPart,
    feePart: r.feePart,
    paid: i < paid,
  }));

const ok = (result: EditedLoan | { error: string }) => {
  if ("error" in result) throw new Error(result.error);
  return result;
};

describe("editLoan", () => {
  const terms = { received: 15000, monthly: 3100.72, months: 6 };
  const original = loanSchedule(terms, "2026-12-05");

  it("saves the same schedule when nothing changed", () => {
    const edited = ok(editLoan(saved(original), { ...terms, nextDue: "2026-12-05" }));
    expect(edited.rows).toEqual(original);
    expect(edited.owedAtStart).toBe(15000);
    expect(edited.feeTotal).toBe(3604.32);
  });

  it("keeps paid payments and spreads what's left over the rest", () => {
    const edited = ok(
      editLoan(saved(original, 2), { ...terms, monthly: 3000, months: 8, nextDue: "2027-02-05" }),
    );
    expect(edited.owedNow).toBe(10000);
    expect(edited.rows.map((r) => r.seq)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(edited.rows[0]).toEqual({
      seq: 3,
      dueOn: "2027-02-05",
      principalPart: 1666.66,
      feePart: 1333.34,
      amount: 3000,
    });
    expect(edited.rows.at(-1)?.dueOn).toBe("2027-07-05");
    expect(edited.rows.reduce((s, r) => s + r.principalPart, 0)).toBeCloseTo(10000, 2);
  });

  it("counts payments made before the app for a running loan", () => {
    // Added at 2 of 6 already paid: rows start at seq 3.
    const running = loanSchedule(terms, "2026-12-05", 2);
    const edited = ok(
      editLoan(saved(running), { ...terms, received: 18000, nextDue: "2026-12-05" }),
    );
    expect(edited.owedAtStart).toBe(12000);
    expect(edited.rows.map((r) => r.seq)).toEqual([3, 4, 5, 6]);
    expect(edited.rows[0].principalPart).toBe(3000);
  });

  it("turns a loan saved as new into one already 4 of 6 paid", () => {
    // SLoan saved with nothing paid, but 4 were paid before the app (Aug to Nov).
    const edited = ok(
      editLoan(saved(original), { ...terms, nextDue: "2026-12-02", paidBefore: 4 }),
    );
    expect(edited.rows.map((r) => [r.seq, r.dueOn])).toEqual([
      [5, "2026-12-02"],
      [6, "2027-01-02"],
    ]);
    expect(edited.owedAtStart).toBe(5000);
    expect(edited.owedNow).toBe(5000);
    expect(edited.rows.every((r) => r.amount === 3100.72)).toBe(true);

    // And back: fewer made before brings the payments back.
    const back = ok(
      editLoan(saved(edited.rows.map((r) => ({ ...r }))), {
        ...terms,
        nextDue: "2026-12-05",
        paidBefore: 0,
      }),
    );
    expect(back.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(back.owedAtStart).toBe(15000);
  });

  it("won't count a payment logged here as made before", () => {
    // 1 of 6 already paid in the app.
    expect(
      editLoan(saved(original, 1), { ...terms, nextDue: "2027-01-05", paidBefore: 1 }),
    ).toHaveProperty("error");
    expect(
      editLoan(saved(original), { ...terms, nextDue: "2027-01-05", paidBefore: 6 }),
    ).toHaveProperty("error");
  });

  it("won't drop below the payments already made", () => {
    expect(
      editLoan(saved(original, 3), { ...terms, months: 2, nextDue: "2027-03-05" }),
    ).toHaveProperty("error");
  });

  it("won't save payments that don't cover what's owed", () => {
    expect(
      editLoan(saved(original), { ...terms, monthly: 1000, nextDue: "2026-12-05" }),
    ).toHaveProperty("error");
  });
});

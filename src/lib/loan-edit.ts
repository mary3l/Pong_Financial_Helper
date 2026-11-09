import { monthlyDates, splitAmount } from "@/lib/forecast";
import { loanPayment, type PaymentRow } from "@/lib/installments";
import { isValidDate } from "@/lib/dates";
import { MAX_AMOUNT, roundCents } from "@/lib/money";

// Editing a loan after it's saved: payments already made stay as they are,
// and the unpaid ones are worked out again from the new terms. Pure, so the
// edit form previews exactly what the server saves.

/** A saved payment of the loan's plan. */
export type SavedPayment = { seq: number; principalPart: number; feePart: number; paid: boolean };

export type LoanEdit = {
  /** What you received ("Loan amount" for one added while already paying). */
  received: number;
  monthly: number;
  months: number;
  /** When the first unpaid payment is due. */
  nextDue: string;
  /**
   * Payments made before the loan was added here, never logged. Left out,
   * they stay as saved. Only for a loan you were already paying.
   */
  paidBefore?: number;
};

export type EditedLoan = {
  /**
   * What you owed when the loan was added here: the amount received, or for
   * one already running, the principal of the payments not made before.
   */
  owedAtStart: number;
  /** Principal still owed after the payments made in the app. */
  owedNow: number;
  /** The unpaid payments, replacing the old ones. */
  rows: PaymentRow[];
  /** Fees and interest of every payment, paid and unpaid. */
  feeTotal: number;
};

export function editLoan(saved: SavedPayment[], edit: LoanEdit): EditedLoan | { error: string } {
  // Payments before the first saved one were made before the app.
  const paid = saved.filter((p) => p.paid);
  const savedFirst = saved.length ? Math.min(...saved.map((p) => p.seq)) : 1;
  const firstPaidHere = paid.length ? Math.min(...paid.map((p) => p.seq)) : Infinity;
  if (edit.paidBefore !== undefined) {
    if (!Number.isInteger(edit.paidBefore) || edit.paidBefore < 0 || edit.paidBefore >= edit.months) {
      return { error: "Payments made before should be fewer than the months." };
    }
    if (edit.paidBefore >= firstPaidHere) {
      return { error: `Payment ${firstPaidHere} is already logged here, so make it ${firstPaidHere - 1} or fewer before.` };
    }
  }
  const firstSeq = edit.paidBefore === undefined ? savedFirst : edit.paidBefore + 1;
  const paidSeqs = new Set(paid.map((p) => p.seq));
  const lastPaid = Math.max(firstSeq - 1, ...paid.map((p) => p.seq));
  if (edit.months < lastPaid) {
    return { error: `You've already made ${lastPaid} payment${lastPaid === 1 ? "" : "s"}, so it can't be fewer months.` };
  }

  const owedAtStart = roundCents(
    splitAmount(edit.received, edit.months)
      .slice(firstSeq - 1)
      .reduce((sum, p) => sum + p, 0),
  );
  const owedNow = roundCents(owedAtStart - paid.reduce((sum, p) => sum + p.principalPart, 0));
  const seqs = Array.from({ length: edit.months - firstSeq + 1 }, (_, i) => firstSeq + i).filter((s) => !paidSeqs.has(s));
  if (seqs.length && owedNow <= 0) {
    return { error: "What you've paid already covers that loan amount. Check the amount or the months." };
  }
  if (!seqs.length && owedNow > 0) {
    return { error: "Every payment is made but some is still owed. Add a month or check the loan amount." };
  }
  if (roundCents(edit.monthly * seqs.length) < owedNow) {
    return { error: "The payments left add up to less than you still owe. Check the monthly payment and months." };
  }

  const principals = seqs.length ? splitAmount(owedNow, seqs.length) : [];
  const dates = monthlyDates(edit.nextDue, seqs.length);
  const rows = seqs.map((seq, i) => {
    const principalPart = principals[i];
    const feePart = roundCents(Math.max(0, loanPayment(edit.monthly, edit.months, seq) - principalPart));
    return { seq, dueOn: dates[i], principalPart, feePart, amount: roundCents(principalPart + feePart) };
  });
  const feeTotal = roundCents(
    paid.reduce((sum, p) => sum + p.feePart, 0) + rows.reduce((sum, r) => sum + r.feePart, 0),
  );
  return { owedAtStart, owedNow: Math.max(0, owedNow), rows, feeTotal };
}

/** A monthly payment as the lender quotes it, to 4 decimals (SLoan's ₱944.585). Rounded per payment in the schedule. */
export function exactRate(value: number) {
  return Math.round(value * 10000) / 10000;
}

const validAmount = (value: number) => Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT;

/** What's wrong with a new loan's terms, or null. Shared by Add loan and a loan for someone else. */
export function checkLoan(input: {
  name: string;
  received: number;
  intoAccountId: string | null;
  receivedOn: string;
  monthly: number;
  months: number;
  nextDue: string;
  alreadyPaid: number;
}): string | null {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "Give the loan a name, like SLoan.";
  if (name.length > 60) return "Keep the name to 60 characters.";
  if (!validAmount(input.received)) return "Enter the amount you received.";
  if (!validAmount(input.monthly)) return "Enter the monthly payment.";
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 60) return "Pick how many months.";
  if (roundCents(input.monthly * input.months) < input.received) {
    return "The payments add up to less than you received. Check the monthly payment and months.";
  }
  if (!isValidDate(input.nextDue)) return "Pick when the next payment is due.";
  if (input.intoAccountId && !isValidDate(input.receivedOn)) return "Pick the day you received it.";
  if (!Number.isInteger(input.alreadyPaid) || input.alreadyPaid < 0 || input.alreadyPaid >= input.months) {
    return "Check how many payments you've already made.";
  }
  if (input.intoAccountId && input.alreadyPaid > 0) {
    return "A loan you just received has no payments yet. Set payments made to 0.";
  }
  return null;
}

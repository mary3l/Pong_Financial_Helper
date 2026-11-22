import { describe, expect, it } from "vitest";
import {
  groupAccounts,
  balanceEffect,
  canEarnInterest,
  cashflow,
  countsAsSpending,
  dailyInterest,
  formatMoney,
  formatPeso,
  fxGain,
  inPesos,
  interestTax,
  interestEstimate,
  interestFor,
  isDebt,
  isSpendable,
  parseAmount,
  parseExactAmount,
  paysInPesos,
  pesoTotal,
  pesoValue,
  roundHalfUp,
  suggestedPayout,
  walletFlow,
} from "@/lib/money";

const txn = (
  type: "expense" | "income" | "transfer",
  amount: number,
  accountId: string,
  toAccountId: string | null = null,
) => ({
  type,
  amount,
  accountId,
  toAccountId,
});

describe("transfers vs expenses", () => {
  it("a transfer moves money between two accounts and is never spending", () => {
    const t = txn("transfer", 500, "gcash", "maribank");
    expect(balanceEffect(t, "gcash")).toBe(-500);
    expect(balanceEffect(t, "maribank")).toBe(500);
    expect(balanceEffect(t, "cash")).toBe(0);
    expect(cashflow([t])).toEqual({ in: 0, out: 0, net: 0 });
  });

  it("an expense only touches its own account and counts as money out", () => {
    const t = txn("expense", 120, "cash");
    expect(balanceEffect(t, "cash")).toBe(-120);
    expect(balanceEffect(t, "gcash")).toBe(0);
    expect(cashflow([t])).toEqual({ in: 0, out: 120, net: -120 });
  });

  it("income adds to its account and counts as money in", () => {
    const t = txn("income", 15000, "bank");
    expect(balanceEffect(t, "bank")).toBe(15000);
    expect(cashflow([t, txn("expense", 2000, "bank")])).toEqual({
      in: 15000,
      out: 2000,
      net: 13000,
    });
  });

  it("a wallet's own in and out counts transfers, since they move its balance", () => {
    const txns = [
      txn("income", 15000, "bank"),
      txn("expense", 2000, "bank"),
      txn("transfer", 500, "bank", "gcash"),
      txn("transfer", 300, "gcash", "bank"),
      txn("expense", 99, "gcash"),
    ];
    expect(walletFlow(txns, "bank")).toEqual({ in: 15300, out: 2500, net: 12800 });
    expect(walletFlow(txns, "gcash")).toEqual({ in: 500, out: 399, net: 101 });
    expect(walletFlow(txns, "cash")).toEqual({ in: 0, out: 0, net: 0 });
  });
});

describe("BNPL and loans", () => {
  it("a BNPL purchase is spending now; paying the bill is a transfer, only the fee is spending", () => {
    const purchase = txn("expense", 3000, "spaylater");
    const installment = txn("transfer", 1000, "gcash", "spaylater");
    const fee = txn("expense", 45, "gcash");
    const spaylater = [purchase, installment].reduce(
      (sum, t) => sum + balanceEffect(t, "spaylater"),
      0,
    );
    expect(spaylater).toBe(-2000); // still owed
    expect(cashflow([purchase, installment, fee]).out).toBe(3045); // the price once, plus the fee
  });

  it("a loan received is a transfer from the loan account, not income", () => {
    const received = txn("transfer", 20000, "sloan", "maribank");
    expect(balanceEffect(received, "sloan")).toBe(-20000);
    expect(balanceEffect(received, "maribank")).toBe(20000);
    expect(cashflow([received]).in).toBe(0);
  });

  it("only cash, banks and e-wallets are spendable", () => {
    expect(["cash", "bank", "ewallet"].every((t) => isSpendable(t as never))).toBe(true);
    expect(isSpendable("credit_line")).toBe(false);
    expect(isSpendable("loan")).toBe(false);
    expect(isSpendable("person")).toBe(false);
    expect(isDebt("credit_line") && isDebt("loan")).toBe(true);
    expect(isDebt("person")).toBe(false);
  });
});

describe("utang and pautang", () => {
  it("lending is a transfer to the person: not spending, and they owe you", () => {
    const lend = txn("transfer", 1000, "gcash", "ana");
    expect(balanceEffect(lend, "ana")).toBe(1000);
    expect(cashflow([lend])).toEqual({ in: 0, out: 0, net: 0 });
  });

  it("being paid back is a transfer, not income", () => {
    const back = txn("transfer", 400, "ana", "gcash");
    expect(balanceEffect(back, "ana")).toBe(-400);
    expect(cashflow([back]).in).toBe(0);
  });

  it("forgiving the rest is an expense from their account, leaving wallets alone", () => {
    const lend = txn("transfer", 1000, "gcash", "ana");
    const back = txn("transfer", 400, "ana", "gcash");
    const forgive = txn("expense", 600, "ana");
    const all = [lend, back, forgive];
    expect(all.reduce((sum, t) => sum + balanceEffect(t, "ana"), 0)).toBe(0);
    expect(balanceEffect(forgive, "gcash")).toBe(0);
    expect(cashflow(all).out).toBe(600);
  });
});

describe("parsing and formatting", () => {
  it("reads typed peso amounts", () => {
    expect(parseAmount("1,250.50")).toBe(1250.5);
    expect(parseAmount("₱ 300")).toBe(300);
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("1.234")).toBeNaN();
  });

  it("reads a monthly payment quoted past centavos, and rounds it half up", () => {
    expect(parseExactAmount("944.585")).toBe(944.585);
    expect(parseExactAmount("₱3,100.7216")).toBe(3100.7216);
    expect(parseExactAmount("1.23456")).toBeNaN();
    expect(roundHalfUp(944.585)).toBe(944.59);
    expect(roundHalfUp(2833.755)).toBe(2833.76);
    expect(roundHalfUp(944.584)).toBe(944.58);
  });

  it("formats pesos with centavos only when there are some", () => {
    expect(formatPeso(1250)).toBe("₱1,250");
    expect(formatPeso(1250.5)).toBe("₱1,250.50");
    expect(formatPeso(-20)).toBe("−₱20");
  });
});

describe("wallet categories", () => {
  it("only spending money counts in Safe to spend", () => {
    expect(countsAsSpending({ type: "ewallet", purpose: "spending" })).toBe(true);
    expect(countsAsSpending({ type: "bank", purpose: "savings" })).toBe(false);
    expect(countsAsSpending({ type: "bank", purpose: "emergency" })).toBe(false);
    expect(countsAsSpending({ type: "bank", purpose: "investment" })).toBe(false);
    // Savings is still your money: it can pay bills and receive transfers.
    expect(isSpendable("bank")).toBe(true);
    expect(countsAsSpending({ type: "credit_line", purpose: "spending" })).toBe(false);
  });
});

describe("daily interest (MariBank, GoTyme)", () => {
  it("is the yearly rate over 365 days, less the 20% final tax", () => {
    // ₱100,000 at 3.65% a year: ₱10 a day before tax, ₱8 after.
    expect(dailyInterest(100_000, 3.65)).toBeCloseTo(8, 10);
    expect(interestFor(100_000, 3.65, 30)).toBe(240);
  });

  it("is nothing on an empty or overdrawn balance, or for no days", () => {
    expect(dailyInterest(0, 4)).toBe(0);
    expect(dailyInterest(-500, 4)).toBe(0);
    expect(interestFor(50_000, 4, 0)).toBe(0);
    expect(interestFor(50_000, 4, -3)).toBe(0);
  });

  it("only banks and e-wallets earn it", () => {
    expect(canEarnInterest("bank") && canEarnInterest("ewallet")).toBe(true);
    expect(canEarnInterest("cash")).toBe(false);
    expect(canEarnInterest("credit_line")).toBe(false);
  });
});

describe("monthly interest (GoTyme Go Save)", () => {
  // ₱100,000 at 3.65% a year: ₱8 a day after tax.
  const goTyme = {
    balance: 100_000,
    interestRate: 3.65,
    interestSince: "2026-10-15",
    interestPayout: "monthly" as const,
  };

  it("splits what was credited on the 1st from what's building up", () => {
    expect(interestEstimate(goTyme, null, "2026-11-03")).toEqual({
      perDay: 8,
      since: "2026-11-01",
      days: 2,
      amount: 16,
      // Oct 15 to Oct 31: 17 days.
      credited: { on: "2026-11-01", from: "2026-10-15", amount: 136 },
      nextPayout: "2026-12-01",
    });
  });

  it("has nothing to log once the 1st's interest is logged", () => {
    const estimate = interestEstimate(goTyme, "2026-11-01", "2026-11-20");
    expect(estimate.credited).toBeNull();
    expect(estimate).toMatchObject({ since: "2026-11-01", days: 19, amount: 152 });
  });

  it("has nothing credited when the rate was set this month", () => {
    const estimate = interestEstimate(
      { ...goTyme, interestSince: "2026-11-01" },
      null,
      "2026-11-01",
    );
    expect(estimate).toMatchObject({
      credited: null,
      days: 0,
      amount: 0,
      nextPayout: "2026-12-01",
    });
  });

  it("rolls the next payout over to January", () => {
    expect(interestEstimate(goTyme, "2026-12-01", "2026-12-10").nextPayout).toBe("2027-01-01");
  });

  it("covers every month missed in one credit", () => {
    expect(interestEstimate(goTyme, null, "2026-12-05").credited).toEqual({
      on: "2026-12-01",
      from: "2026-10-15",
      amount: 376, // 17 days in October + 30 in November
    });
  });

  it("leaves daily wallets (MariBank) as they were", () => {
    const mari = { ...goTyme, interestPayout: "daily" as const };
    expect(interestEstimate(mari, "2026-10-31", "2026-11-03")).toEqual({
      perDay: 8,
      since: "2026-10-31",
      days: 3,
      amount: 24,
      credited: null,
      nextPayout: null,
    });
  });

  it("starts a new GoTyme wallet as monthly", () => {
    expect(suggestedPayout("GoTyme Go Save")).toBe("monthly");
    expect(suggestedPayout("go tyme")).toBe("monthly");
    expect(suggestedPayout("MariBank")).toBe("daily");
  });
});

describe("balance adjustments", () => {
  const up = {
    type: "income" as const,
    amount: 200,
    accountId: "a",
    toAccountId: null,
    category: "adjustment",
  };
  const down = {
    type: "expense" as const,
    amount: 50,
    accountId: "a",
    toAccountId: null,
    category: "adjustment",
  };

  it("are neither money in nor money out", () => {
    const lunch = { type: "expense" as const, amount: 120, category: "food" };
    expect(cashflow([up, down, lunch])).toEqual({ in: 0, out: 120, net: -120 });
  });

  it("still move the wallet's balance", () => {
    expect(balanceEffect(up, "a")).toBe(200);
    expect(balanceEffect(down, "a")).toBe(-50);
    expect(walletFlow([up, down], "a")).toEqual({ in: 200, out: 50, net: 150 });
  });
});

describe("dollar wallets (GoTyme USD Time Deposit)", () => {
  const td = {
    balance: 10_000,
    interestRate: 3.65,
    interestSince: "2026-08-05",
    interestPayout: "maturity" as const,
    currency: "USD" as const,
    maturesOn: "2026-11-05",
  };

  it("shows dollars as dollars and counts them in pesos at the wallet's rate", () => {
    expect(formatMoney(1250.5, "USD")).toBe("$1,250.50");
    expect(formatMoney(500, "USD")).toBe("$500");
    expect(formatMoney(-20, "USD")).toBe("−$20");
    expect(formatMoney(1250, "PHP")).toBe(formatPeso(1250));
    expect(pesoValue({ balance: 100, currency: "USD", fxRate: 58.5 })).toBe(5850);
    expect(pesoValue({ balance: 100 })).toBe(100);
    expect(
      pesoTotal([
        { balance: 100, currency: "USD", fxRate: 58.5 },
        { balance: 1000, currency: "PHP" },
      ]),
    ).toBe(6850);
  });

  it("never pays for things: only peso wallets do", () => {
    expect(paysInPesos({ type: "bank", currency: "USD" })).toBe(false);
    expect(paysInPesos({ type: "bank", currency: "PHP" })).toBe(true);
    expect(paysInPesos({ type: "ewallet" })).toBe(true);
    expect(paysInPesos({ type: "credit_line" })).toBe(false);
  });

  it("a peso to dollar transfer takes pesos out and puts dollars in", () => {
    const t = {
      type: "transfer" as const,
      amount: 5850,
      accountId: "gcash",
      toAccountId: "usd",
      toAmount: 100,
    };
    expect(balanceEffect(t, "gcash")).toBe(-5850);
    expect(balanceEffect(t, "usd")).toBe(100);
    expect(walletFlow([t], "usd")).toEqual({ in: 100, out: 0, net: 100 });
    expect(cashflow([t])).toEqual({ in: 0, out: 0, net: 0 });
  });

  it("counts interest on a dollar wallet in pesos in totals", () => {
    const accounts = [
      { id: "usd", currency: "USD" as const, fxRate: 58 },
      { id: "gcash", currency: "PHP" as const, fxRate: null },
    ];
    const txns = [
      { type: "income" as const, amount: 2, accountId: "usd", category: "interest" },
      { type: "income" as const, amount: 100, accountId: "gcash", category: "salary" },
    ];
    expect(cashflow(inPesos(txns, accounts)).in).toBe(216);
  });

  it("is taxed 15%, not 20%", () => {
    expect(interestTax("USD")).toBe(0.15);
    expect(interestTax("PHP")).toBe(0.2);
    // $10,000 at 3.65%: $1 a day before tax, $0.85 after.
    expect(dailyInterest(10_000, 3.65, interestTax("USD"))).toBeCloseTo(0.85, 10);
  });

  it("builds interest up until it matures", () => {
    expect(interestEstimate(td, null, "2026-10-05")).toEqual({
      perDay: 0.85,
      since: "2026-08-05",
      days: 61,
      amount: 51.85,
      credited: null,
      nextPayout: "2026-11-05",
    });
  });

  it("credits it all on the day it matures, then stops earning", () => {
    expect(interestEstimate(td, null, "2026-11-10")).toEqual({
      perDay: 0,
      since: "2026-11-05",
      days: 0,
      amount: 0,
      // Aug 5 to Nov 5: 92 days.
      credited: { on: "2026-11-05", from: "2026-08-05", amount: 78.2 },
      nextPayout: null,
    });
    expect(interestEstimate(td, "2026-11-05", "2026-11-10").credited).toBeNull();
  });
});

describe("what the exchange rate did to your dollars", () => {
  it("is pesos gained or lost from the rate you got to today's", () => {
    // $5 bought at ₱62.96, worth ₱63.48 each today: ₱2.60 more.
    expect(fxGain({ balance: 5, currency: "USD", fxRate: 63.48, boughtAt: 62.96 })).toBe(2.6);
    expect(fxGain({ balance: 100, currency: "USD", fxRate: 57.5, boughtAt: 58 })).toBe(-50);
  });

  it("is nothing for pesos, or without both rates", () => {
    expect(fxGain({ balance: 1000, currency: "PHP" })).toBe(0);
    expect(fxGain({ balance: 5, currency: "USD", fxRate: 63.48, boughtAt: null })).toBe(0);
  });
});

describe("groupAccounts", () => {
  it("puts wallets first, then savings, cards, BNPL, loans and people, dropping empty groups", () => {
    const list = [
      { id: "p", type: "person" as const },
      { id: "spl", type: "credit_line" as const },
      { id: "bpi", type: "credit_line" as const, creditKind: "card" as const },
      { id: "ef", type: "bank" as const, purpose: "emergency" as const },
      { id: "cash", type: "cash" as const, purpose: "spending" as const },
      { id: "gcash", type: "ewallet" as const },
    ];
    expect(groupAccounts(list).map((g) => [g.label, g.accounts.map((a) => a.id)])).toEqual([
      ["Wallets", ["cash", "gcash"]],
      ["Savings", ["ef"]],
      ["Credit cards", ["bpi"]],
      ["BNPL", ["spl"]],
      ["People", ["p"]],
    ]);
  });
});

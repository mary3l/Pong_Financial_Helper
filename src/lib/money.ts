// Money rules shared by the server and the browser. See the design canvas,
// rows 4 and 5, and the comments in supabase/migrations.

import { daysBetween } from "@/lib/dates";
import { interestPresetFor } from "@/lib/interest-presets";

/** "person" holds utang and pautang with one person (Phase 4). */
export type AccountType = "cash" | "bank" | "ewallet" | "credit_line" | "loan" | "person";
export type TransactionType = "expense" | "income" | "transfer";

/** Accounts that hold your own money. Credit lines and loans have their own forms. */
export const WALLET_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "ewallet", label: "E-wallet" },
] as const satisfies readonly { value: AccountType; label: string }[];

export type WalletType = (typeof WALLET_TYPES)[number]["value"];

export function isWalletType(value: unknown): value is WalletType {
  return WALLET_TYPES.some((t) => t.value === value);
}

export function accountTypeLabel(type: AccountType): string {
  return (
    WALLET_TYPES.find((t) => t.value === type)?.label ??
    (type === "credit_line" ? "BNPL" : type === "loan" ? "Loan" : "Person")
  );
}

/**
 * What a wallet's money is for, in cashflow terms. Only spending money
 * counts in Safe to spend and the forecast; the rest is still yours (You
 * have, Net worth) but set aside.
 */
export const WALLET_PURPOSES = [
  { value: "spending", label: "Spending" },
  { value: "savings", label: "Savings" },
  { value: "emergency", label: "Emergency fund" },
  { value: "investment", label: "Investments" },
] as const;

export type WalletPurpose = (typeof WALLET_PURPOSES)[number]["value"];

export function isWalletPurpose(value: unknown): value is WalletPurpose {
  return WALLET_PURPOSES.some((p) => p.value === value);
}

export function purposeLabel(purpose: WalletPurpose): string {
  return WALLET_PURPOSES.find((p) => p.value === purpose)?.label ?? "Spending";
}

/** Cash, bank and e-wallet money that's meant for spending: what Safe to spend works from. */
export function countsAsSpending(account: { type: AccountType; purpose: WalletPurpose }): boolean {
  return isSpendable(account.type) && account.purpose === "spending";
}

/**
 * What a wallet holds. Its balance and every transaction on it are in this
 * currency. Dollar wallets (a GoTyme USD Time Deposit) count in pesos at the
 * rate you set on them, and are never spending money.
 */
export const CURRENCIES = [
  { value: "PHP", label: "Pesos", symbol: "₱" },
  { value: "USD", label: "US dollars", symbol: "$" },
] as const;

export type Currency = (typeof CURRENCIES)[number]["value"];

export function isCurrency(value: unknown): value is Currency {
  return CURRENCIES.some((c) => c.value === value);
}

export function currencySymbol(currency: Currency = "PHP"): string {
  return currency === "USD" ? "$" : "₱";
}

type Valued = { balance: number; currency?: Currency; fxRate?: number | null };

/** A wallet's balance in pesos: dollars at the rate set on it. */
export function pesoValue(account: Valued): number {
  return account.currency === "USD"
    ? roundCents(account.balance * (account.fxRate ?? 0))
    : account.balance;
}

/**
 * How many more pesos a dollar wallet is worth now than at the rate you got
 * for it: balance × (rate now − rate you got). Below 0 when the peso got
 * stronger. Interest isn't in it, only the rate's move.
 */
export function fxGain(account: {
  balance: number;
  currency?: Currency;
  fxRate?: number | null;
  boughtAt?: number | null;
}): number {
  if (account.currency !== "USD" || !account.fxRate || !account.boughtAt) return 0;
  return roundCents(account.balance * (account.fxRate - account.boughtAt));
}

/** What some wallets add up to in pesos, dollars converted. */
export function pesoTotal(accounts: Valued[]): number {
  return roundCents(accounts.reduce((sum, a) => sum + pesoValue(a), 0));
}

/** Peso cash, banks and e-wallets: what you pay with or log an expense on. Dollars only move by transfer. */
export function paysInPesos(account: { type: AccountType; currency?: Currency }): boolean {
  return isSpendable(account.type) && account.currency !== "USD";
}

/** Digital banks (MariBank, GoTyme) and e-wallet savings (Maya, GSave) pay interest daily. */
export function canEarnInterest(type: AccountType): boolean {
  return type === "bank" || type === "ewallet";
}

/** Interest on Philippine deposits has a 20% final withholding tax. */
export const INTEREST_TAX = 0.2;

/** Dollar deposits (foreign currency deposits) have a 15% final tax instead. */
export const USD_INTEREST_TAX = 0.15;

export function interestTax(currency: Currency = "PHP"): number {
  return currency === "USD" ? USD_INTEREST_TAX : INTEREST_TAX;
}

/**
 * Interest credited for one day on `balance` at `ratePerYear` % a year,
 * after tax. Not rounded: banks round the day's total, so callers round.
 */
export function dailyInterest(balance: number, ratePerYear: number, tax = INTEREST_TAX): number {
  if (balance <= 0 || ratePerYear <= 0) return 0;
  return ((balance * ratePerYear) / 100 / 365) * (1 - tax);
}

/** Interest after tax over `days` days on a steady balance. */
export function interestFor(
  balance: number,
  ratePerYear: number,
  days: number,
  tax = INTEREST_TAX,
): number {
  return roundCents(dailyInterest(balance, ratePerYear, tax) * Math.max(0, days));
}

/**
 * When a bank credits the interest it works out every day. MariBank adds it
 * daily; GoTyme Go Save adds the month's interest on the 1st; a time deposit
 * adds it all on the day it matures.
 */
export const INTEREST_PAYOUTS = [
  { value: "daily", label: "Every day" },
  { value: "monthly", label: "On the 1st of the month" },
  { value: "maturity", label: "When it matures" },
] as const;

export type InterestPayout = (typeof INTEREST_PAYOUTS)[number]["value"];

export function isInterestPayout(value: unknown): value is InterestPayout {
  return INTEREST_PAYOUTS.some((p) => p.value === value);
}

/** GoTyme and GSave pay monthly; a new wallet named after one starts that way. */
export function suggestedPayout(walletName: string): InterestPayout {
  return interestPresetFor(walletName)?.payout ?? "daily";
}

/** "2026-11-03" → "2026-11-01" */
function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** "2026-12-15" → "2027-01-01" */
function firstOfNextMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export type InterestEstimate = {
  /** After tax, on today's balance. */
  perDay: number;
  /** What's built up and not credited yet, from `since` to today. */
  since: string;
  days: number;
  amount: number;
  /**
   * Monthly payout (GoTyme): what the bank credited on the 1st that isn't
   * logged yet, from the last logged interest (or the rate) up to `on`.
   * Time deposit: everything it earned, once it has matured.
   */
  credited: { on: string; from: string; amount: number } | null;
  /** Monthly payout: the next 1st. Time deposit: the day it matures, until it does. Null for daily. */
  nextPayout: string | null;
};

/**
 * What a wallet's interest looks like today. Daily payout: everything since
 * the last logged interest (or since the rate was set) is already in the
 * bank's balance. Monthly payout: the part up to the last 1st is credited,
 * the rest builds up until the next 1st. Time deposit: it builds up until
 * the day it matures, then it's all credited. Estimates use today's balance,
 * after the 20% tax (15% on dollars).
 */
export function interestEstimate(
  wallet: {
    balance: number;
    interestRate: number;
    interestSince: string | null;
    interestPayout: InterestPayout;
    currency?: Currency;
    /** Time deposits: the day it matures. */
    maturesOn?: string | null;
  },
  lastLogged: string | null,
  today: string,
): InterestEstimate {
  const { balance, interestRate: rate } = wallet;
  const tax = interestTax(wallet.currency);
  const start = [wallet.interestSince ?? today, lastLogged ?? ""].sort().at(-1)!;
  const perDay = roundCents(dailyInterest(balance, rate, tax));

  if (wallet.interestPayout === "daily") {
    const days = Math.max(0, daysBetween(start, today));
    return {
      perDay,
      since: start,
      days,
      amount: interestFor(balance, rate, days, tax),
      credited: null,
      nextPayout: null,
    };
  }

  if (wallet.interestPayout === "maturity") {
    const matures = wallet.maturesOn ?? today;
    if (today < matures) {
      const days = Math.max(0, daysBetween(start, today));
      return {
        perDay,
        since: start,
        days,
        amount: interestFor(balance, rate, days, tax),
        credited: null,
        nextPayout: matures,
      };
    }
    // Matured: it stops earning, and what it earned is credited that day.
    const credited =
      start < matures
        ? {
            on: matures,
            from: start,
            amount: interestFor(balance, rate, daysBetween(start, matures), tax),
          }
        : null;
    return { perDay: 0, since: matures, days: 0, amount: 0, credited, nextPayout: null };
  }

  const payday = firstOfMonth(today);
  const credited =
    start < payday
      ? {
          on: payday,
          from: start,
          amount: interestFor(balance, rate, daysBetween(start, payday), tax),
        }
      : null;
  const since = credited ? payday : start;
  const days = Math.max(0, daysBetween(since, today));
  return {
    perDay,
    since,
    days,
    amount: interestFor(balance, rate, days, tax),
    credited,
    nextPayout: firstOfNextMonth(today),
  };
}

/** Credit lines (SPayLater, Atome) and loans (SLoan, MariLoan): money you owe. */
export function isDebt(type: AccountType): boolean {
  return type === "credit_line" || type === "loan";
}

/** Money that's actually yours to spend. Credit limits and loans never count. */
export function isSpendable(type: AccountType): boolean {
  return type === "cash" || type === "bank" || type === "ewallet";
}

/** Largest amount numeric(14, 2) can hold. */
export const MAX_AMOUNT = 999_999_999_999.99;

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Parses a typed peso amount like "1,250.50" or "₱ 300". NaN when it isn't one. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return NaN;
  return roundCents(Number(cleaned));
}

/**
 * A rate like a loan's monthly payment, quoted to more than centavos
 * (SLoan's ₱944.585). Up to 4 decimals, kept exact. NaN when it isn't one.
 */
export function parseExactAmount(text: string): number {
  const cleaned = text.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{0,4})?$|^\.\d{1,4}$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 10000) / 10000;
}

/** To centavos, half up, without float slips: 944.585 is ₱944.59, not ₱944.58. */
export function roundHalfUp(value: number): number {
  return Math.round(Number((value * 100).toFixed(6))) / 100;
}

const WHOLE = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const CENTS = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₱1,250", or "₱1,250.50" when there are centavos. */
export function formatPeso(value: number): string {
  const rounded = roundCents(value);
  const text = Number.isInteger(rounded)
    ? WHOLE.format(Math.abs(rounded))
    : CENTS.format(Math.abs(rounded));
  return rounded < 0 ? `−${text}` : text;
}

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** formatPeso for pesos; "$1,250" or "$1,250.50" for dollars. */
export function formatMoney(value: number, currency: Currency = "PHP"): string {
  if (currency !== "USD") return formatPeso(value);
  const rounded = roundCents(value);
  const text = Number.isInteger(rounded)
    ? USD_WHOLE.format(Math.abs(rounded))
    : USD_CENTS.format(Math.abs(rounded));
  return rounded < 0 ? `−${text}` : text;
}

/** A wallet's balance in its own currency: "₱1,250" or "$500". */
export function formatBalance(account: { balance: number; currency?: Currency }): string {
  return formatMoney(account.balance, account.currency);
}

/**
 * How a transaction changes one account's balance, in that account's
 * currency. Transfers move money between your own wallets, so they're never
 * spending, but they still change both balances. Between a peso and a
 * dollar wallet, `toAmount` is what landed.
 */
export function balanceEffect(
  txn: {
    type: TransactionType;
    amount: number;
    accountId: string;
    toAccountId: string | null;
    toAmount?: number | null;
  },
  accountId: string,
): number {
  if (txn.type === "transfer") {
    if (txn.toAccountId === accountId) return txn.toAmount ?? txn.amount;
    if (txn.accountId === accountId) return -txn.amount;
    return 0;
  }
  if (txn.accountId !== accountId) return 0;
  return txn.type === "income" ? txn.amount : -txn.amount;
}

/**
 * Income and expenses on dollar wallets turned into pesos at each wallet's
 * rate, so totals like Activity's money in add up in one currency.
 */
export function inPesos<T extends { type: TransactionType; amount: number; accountId: string }>(
  txns: T[],
  accounts: { id: string; currency?: Currency; fxRate?: number | null }[],
): T[] {
  const rates = new Map(
    accounts.filter((a) => a.currency === "USD").map((a) => [a.id, a.fxRate ?? 0]),
  );
  if (!rates.size) return txns;
  return txns.map((t) =>
    t.type !== "transfer" && rates.has(t.accountId)
      ? { ...t, amount: roundCents(t.amount * rates.get(t.accountId)!) }
      : t,
  );
}

/**
 * Money in and out for a list of transactions. Transfers and balance
 * adjustments (category "adjustment") count as neither.
 */
export function cashflow(
  txns: { type: TransactionType; amount: number; category?: string | null }[],
) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of txns) {
    if (t.category === "adjustment") continue;
    if (t.type === "income") moneyIn += t.amount;
    else if (t.type === "expense") moneyOut += t.amount;
  }
  return {
    in: roundCents(moneyIn),
    out: roundCents(moneyOut),
    net: roundCents(moneyIn - moneyOut),
  };
}

/**
 * Money in and out of one wallet. Unlike cashflow, transfers count: moving
 * ₱500 from GCash to MariBank is ₱500 out of GCash and ₱500 into MariBank.
 */
export function walletFlow(
  txns: {
    type: TransactionType;
    amount: number;
    accountId: string;
    toAccountId: string | null;
    toAmount?: number | null;
  }[],
  accountId: string,
) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of txns) {
    const effect = balanceEffect(t, accountId);
    if (effect > 0) moneyIn += effect;
    else moneyOut -= effect;
  }
  return {
    in: roundCents(moneyIn),
    out: roundCents(moneyOut),
    net: roundCents(moneyIn - moneyOut),
  };
}

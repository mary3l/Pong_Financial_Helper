// Savings goals, the way GoTyme GoalSave works: each goal is its own pocket
// with a target and a deadline, interest is worked out every day on the
// day's end balance (rate ÷ 365), and the month's interest is added on the
// 1st after the 20% tax. Auto-save puts money in every day, week or month.
// Here each goal is a wallet with a target, so MariBank (interest added
// daily) and plain savings work the same way.

import { addDays, dateInMonth, daysBetween } from "@/lib/dates";
import { dailyInterest, roundCents, type InterestEstimate, type InterestPayout } from "@/lib/money";

/** A wallet named after GoTyme. */
export function isGoTyme(walletName: string): boolean {
  return /go\s*tyme/i.test(walletName);
}

/** How often you put money in, like GoTyme's auto-save. */
export const SAVE_EVERY = [
  { value: "daily", label: "Daily", per: "a day" },
  { value: "weekly", label: "Weekly", per: "a week" },
  { value: "monthly", label: "Monthly", per: "a month" },
] as const;

export type SaveEvery = (typeof SAVE_EVERY)[number]["value"];

/** Goals can't be further out than this; it keeps the day-by-day math quick. */
export const GOAL_MAX_YEARS = 30;

/** Deposits start today and repeat; a monthly one moves to the month's last day when it's short. */
function isDepositDay(day: string, from: string, every: SaveEvery, dayNumber: number): boolean {
  if (every === "daily") return true;
  if (every === "weekly") return dayNumber % 7 === 0;
  const [y, m] = day.split("-").map(Number);
  return dateInMonth(y, m, Number(from.slice(8))) === day;
}

export type Projection = {
  /** In the wallet at the end of `to`: deposits plus the interest credited by then. */
  balance: number;
  /** Interest credited from `from` to `to`, after tax. */
  interest: number;
  deposits: number;
};

/**
 * Day by day from `from` to `to`, both included. Each day: the 1st's credit
 * (monthly payout), that day's deposit, then interest on the day's end
 * balance. Monthly interest builds up unrounded and is rounded when credited,
 * as the bank does; daily interest is rounded and added every day.
 */
export function projectBalance({
  balance,
  ratePerYear,
  payout,
  pending = 0,
  from,
  to,
  deposit = 0,
  every = "monthly",
}: {
  balance: number;
  ratePerYear: number | null;
  payout: InterestPayout;
  /** Monthly payout: after-tax interest since the last 1st, added on the next one. */
  pending?: number;
  from: string;
  to: string;
  deposit?: number;
  every?: SaveEvery;
}): Projection {
  const rate = ratePerYear ?? 0;
  let money = balance;
  let building = payout === "monthly" ? pending : 0;
  let interest = 0;
  let deposits = 0;

  for (let day = from, n = 0; day <= to; day = addDays(day, 1), n++) {
    // Today's 1st was already credited: the estimate counts it.
    if (payout === "monthly" && n > 0 && day.endsWith("-01")) {
      const credit = roundCents(building);
      money += credit;
      interest += credit;
      building = 0;
    }
    if (deposit > 0 && isDepositDay(day, from, every, n)) {
      money += deposit;
      deposits++;
    }
    const earned = dailyInterest(money, rate);
    if (payout === "daily") {
      const credit = roundCents(earned);
      money += credit;
      interest += credit;
    } else {
      building += earned;
    }
  }
  return { balance: roundCents(money), interest: roundCents(interest), deposits };
}

export type SavingsNeeded = {
  /** Whole pesos each time, starting today. */
  amount: number;
  deposits: number;
  /** Interest credited by the deadline at that pace. */
  interest: number;
};

export type GoalPlan = {
  target: number;
  saved: number;
  /** 0 to 1. */
  progress: number;
  left: number;
  reached: boolean;
  deadline: string | null;
  /** Days from today to the deadline; below 0 once it's passed. */
  daysLeft: number | null;
  /** With no more deposits: what interest alone makes it by the deadline. */
  interestOnly: Projection | null;
  /** What to put in to get there, for each auto-save choice. Null when there's nothing to plan. */
  needed: Record<SaveEvery, SavingsNeeded> | null;
};

/**
 * Where a goal stands and what to save to make it. `accrued` is the wallet's
 * interest estimate: interest the bank already added but isn't logged yet
 * counts toward the projection, not toward what's saved.
 */
export function goalPlan(
  wallet: { balance: number; interestRate: number | null; interestPayout: InterestPayout },
  goal: { amount: number; date: string | null },
  today: string,
  accrued: InterestEstimate | null = null,
): GoalPlan {
  const saved = roundCents(wallet.balance);
  const target = goal.amount;
  const left = roundCents(Math.max(0, target - saved));
  const reached = left === 0;
  const deadline = goal.date;
  const daysLeft = deadline ? daysBetween(today, deadline) : null;
  const base = {
    target,
    saved,
    progress: target > 0 ? Math.min(1, Math.max(0, saved / target)) : 0,
    left,
    reached,
    deadline,
    daysLeft,
  };
  if (!deadline || daysLeft === null || daysLeft < 0)
    return { ...base, interestOnly: null, needed: null };

  const unlogged = !accrued
    ? 0
    : wallet.interestPayout === "daily"
      ? accrued.amount
      : (accrued.credited?.amount ?? 0);
  const start = {
    balance: wallet.balance + unlogged,
    ratePerYear: wallet.interestRate,
    payout: wallet.interestPayout,
    pending: wallet.interestPayout === "monthly" ? (accrued?.amount ?? 0) : 0,
    from: today,
    to: deadline,
  };
  const interestOnly = projectBalance(start);
  if (reached || interestOnly.balance >= target) return { ...base, interestOnly, needed: null };

  const needed = {} as Record<SaveEvery, SavingsNeeded>;
  for (const { value: every } of SAVE_EVERY) {
    const at = (deposit: number) => projectBalance({ ...start, deposit, every });
    // One deposit of everything that's left, today, always gets there.
    let lo = 1;
    let hi = Math.max(1, Math.ceil(target - start.balance));
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (at(mid).balance >= target) hi = mid;
      else lo = mid + 1;
    }
    const result = at(lo);
    needed[every] = { amount: lo, deposits: result.deposits, interest: result.interest };
  }
  return { ...base, interestOnly, needed };
}

import type { Account } from "@/lib/data";
import {
  dailyInterest,
  interestEstimate,
  interestTax,
  pesoValue,
  roundCents,
  type InterestEstimate,
} from "@/lib/money";

/**
 * Interest on the wallets shown on the Wallets or Savings tab: what's built
 * up on each since it was last logged (MariBank), or what it credited on the
 * 1st that isn't logged yet (GoTyme), and about how much they earn a month.
 */
export function walletInterest(
  wallets: Account[],
  lastInterest: Map<string, string>,
  today: string,
): { accrued: Record<string, InterestEstimate>; perMonth: number } {
  const accrued: Record<string, InterestEstimate> = {};
  for (const a of wallets) {
    if (!a.interestRate) continue;
    accrued[a.id] = interestEstimate({ ...a, interestRate: a.interestRate }, lastInterest.get(a.id) ?? null, today);
  }
  // In pesos; a time deposit stops earning once it matures.
  const perMonth = roundCents(
    wallets.reduce((sum, a) => {
      if (!a.interestRate || (a.interestPayout === "maturity" && a.maturesOn && a.maturesOn <= today)) return sum;
      const month = dailyInterest(a.balance, a.interestRate, interestTax(a.currency)) * 30;
      return sum + pesoValue({ ...a, balance: month });
    }, 0),
  );
  return { accrued, perMonth };
}

/** On the Savings tab: set aside (savings, emergency fund, investments) or in dollars. */
export function isSavingsWallet(account: Pick<Account, "purpose" | "currency">): boolean {
  return account.purpose !== "spending" || account.currency === "USD";
}

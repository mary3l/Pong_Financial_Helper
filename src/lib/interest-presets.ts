// Interest on the savings people here keep in apps: MariBank, GSave in
// GCash, Maya Savings, GoTyme GoalSave and the GoTyme USD Time Deposit.
// Typing one of these names into a wallet offers its rate, so you don't have
// to look it up. Rates change, so the form still lets you type what the app
// shows you.
//
// All of them work interest out every day and take the final tax (20% on
// pesos, 15% on dollars) before crediting; what differs is when it's credited.

import type { Currency, InterestPayout, WalletType } from "@/lib/money";

/** When these rates were checked. */
export const PRESET_RATES_AS_OF = "November 2026";

export type InterestPreset = {
  key: "maribank" | "gsave" | "maya" | "gotyme" | "gotyme_usd_td";
  /** The account that earns, like "Maya Savings". */
  label: string;
  /** % a year, before tax. Null when it depends on the term you pick: type what the app shows. */
  rate: number | null;
  payout: InterestPayout;
  type: WalletType;
  /** Left out for pesos. */
  currency?: Currency;
  /** Set aside from Safe to spend when applied (GoTyme GoalSave is savings by design). */
  savings: boolean;
  /** How it works, in a sentence or two. */
  about: string;
  match: RegExp;
};

export const INTEREST_PRESETS: readonly InterestPreset[] = [
  {
    key: "maribank",
    label: "MariBank Savings",
    rate: 3.25,
    payout: "daily",
    type: "bank",
    savings: false,
    about: "3.25% a year on up to ₱1M (3.75% above that), added every midnight after tax.",
    match: /mari\s*bank|sea\s*bank/i,
  },
  {
    key: "gsave",
    label: "GSave by CIMB",
    rate: 2.3,
    payout: "monthly",
    type: "ewallet",
    savings: false,
    about:
      "2.30% a year in GSave (CIMB, inside GCash) since June 2026, added once a month after tax. " +
      "Your main GCash balance doesn't earn interest, so use this on GSave only.",
    match: /g\s*cash|g\s*save|cimb/i,
  },
  {
    key: "maya",
    label: "Maya Savings",
    rate: 3,
    payout: "daily",
    type: "ewallet",
    savings: false,
    about:
      "3% a year base, added daily after tax. Missions can boost it up to 15% on the first ₱100k " +
      "for the month; type that rate instead if you hit them. Your Maya Wallet doesn't earn interest.",
    match: /maya|paymaya/i,
  },
  // Before GoalSave: "GoTyme USD" would match both.
  {
    key: "gotyme_usd_td",
    label: "GoTyme USD Time Deposit",
    rate: null,
    payout: "maturity",
    type: "bank",
    currency: "USD",
    savings: true,
    about:
      "Held in US dollars for 3 or 6 months, from $1. Interest builds up daily and is added when it " +
      "matures, after a 15% tax (not 20%). Taking it out early loses the interest. Type the rate and " +
      "maturity date from the app.",
    match:
      /go\s*tyme.*(usd|dollar|\$|time\s*deposit|\btd\b)|(usd|dollar|\$|time\s*deposit|\btd\b).*go\s*tyme/i,
  },
  {
    key: "gotyme",
    label: "GoTyme GoalSave",
    rate: 3,
    payout: "monthly",
    type: "bank",
    savings: true,
    about:
      "3% a year, worked out daily and added on the 1st after tax. Add each GoalSave (up to 5) as its own wallet.",
    match: /go\s*tyme/i,
  },
];

/** The preset a wallet's name points to, if any. */
export function interestPresetFor(walletName: string): InterestPreset | null {
  return INTEREST_PRESETS.find((p) => p.match.test(walletName)) ?? null;
}

/** Whether a wallet is already set up the way its preset says. */
export function matchesPreset(
  preset: InterestPreset,
  wallet: {
    type: WalletType;
    purpose: string;
    rate: string;
    payout: InterestPayout;
    currency?: Currency;
  },
): boolean {
  return (
    wallet.type === preset.type &&
    (preset.rate === null || Number(wallet.rate.replace(/[%\s]/g, "")) === preset.rate) &&
    wallet.payout === preset.payout &&
    (wallet.currency ?? "PHP") === (preset.currency ?? "PHP") &&
    (!preset.savings || wallet.purpose !== "spending")
  );
}

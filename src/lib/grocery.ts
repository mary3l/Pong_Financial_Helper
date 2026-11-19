import type { PongMood } from "@/components/pong";
import { formatPeso, roundCents } from "@/lib/money";

// Grocery mode (design canvas row 6). Pure, so it's easy to test: totals,
// the budget status line, and price memory lookups.

export type CartItem = {
  /** Unique within the trip. */
  key: string;
  /** Null for items with no barcode. */
  barcode: string | null;
  name: string;
  price: number;
  qty: number;
};

/** Barcode → what you called it and what it cost, per store. */
export type PriceMemory = Record<
  string,
  { name: string; prices: Record<string, number>; last: number }
>;

export function cartTotal(items: CartItem[]): number {
  return roundCents(items.reduce((sum, i) => sum + i.price * i.qty, 0));
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.qty, 0);
}

export type BudgetStatus = {
  tone: "ok" | "careful" | "over";
  mood: PongMood;
  message: string;
  /** 0–100, for the progress bar. */
  pct: number;
};

/** "₱1,200 left", "Careful: only ₱300 left (85%)", "Over by ₱150. Remove something?" */
export function budgetStatus(total: number, budget: number | null, warnAt = 0.8): BudgetStatus {
  if (!budget) {
    return { tone: "ok", mood: "happy", message: `${formatPeso(total)} so far`, pct: 0 };
  }
  const ratio = total / budget;
  const pct = Math.min(100, Math.round(ratio * 100));
  if (total > budget) {
    return {
      tone: "over",
      mood: "shocked",
      message: `Over by ${formatPeso(total - budget)}. Remove something?`,
      pct,
    };
  }
  if (ratio >= warnAt) {
    return {
      tone: "careful",
      mood: "worried",
      message: `Careful: only ${formatPeso(budget - total)} left (${pct}%)`,
      pct,
    };
  }
  return { tone: "ok", mood: "happy", message: `${formatPeso(budget - total)} left`, pct };
}

/** What adding one item does: tells you if THAT item pushes you over. */
export function scanNote(before: number, price: number, budget: number | null): string {
  const after = before + price;
  if (!budget) return `${formatPeso(after)} so far`;
  if (after > budget && before <= budget)
    return `this item puts you over by ${formatPeso(after - budget)}`;
  if (after > budget) return `now over by ${formatPeso(after - budget)}`;
  return `${formatPeso(budget - after)} left`;
}

/** Adds one of an item, stacking it on a matching line. */
export function addToCart(
  items: CartItem[],
  item: Omit<CartItem, "key" | "qty">,
  key: string,
): CartItem[] {
  const i = items.findIndex(
    (x) => x.name === item.name && x.price === item.price && x.barcode === item.barcode,
  );
  if (i >= 0) return items.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
  return [{ ...item, key, qty: 1 }, ...items];
}

/** The remembered price for a barcode: at this store if seen there, else the last one anywhere. */
export function rememberedPrice(memory: PriceMemory, barcode: string, store: string) {
  const known = memory[barcode];
  if (!known) return null;
  const here = known.prices[store];
  return { name: known.name, price: here ?? known.last, atThisStore: here !== undefined };
}

/** "Receipt is ₱40 higher than scanned." */
export function receiptNote(scanned: number, receipt: number): string {
  const diff = roundCents(receipt - scanned);
  if (diff === 0) return "Matches what you scanned. Nice!";
  return diff > 0
    ? `Receipt is ${formatPeso(diff)} higher than scanned. A price may have changed or an item wasn't scanned.`
    : `Receipt is ${formatPeso(-diff)} lower than scanned. A promo, maybe?`;
}

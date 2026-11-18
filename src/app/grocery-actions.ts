"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { isValidDate } from "@/lib/dates";
import { MAX_AMOUNT, isSpendable, roundCents, type AccountType } from "@/lib/money";

// Phase 5: Grocery mode checkout. See 0007_grocery.sql.

export type TripInput = {
  store: string;
  budget: number | null;
  accountId: string;
  receiptTotal: number;
  occurredOn: string;
  items: { barcode: string | null; name: string; price: number; qty: number }[];
};

export type GroceryResult = { error?: string };

const FAILED = { error: "Couldn't save your groceries. Your cart is still here; try again." };

function clean(text: unknown, max: number) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Saves the trip as ONE Groceries expense for the receipt total, with the
 * items attached, and remembers each barcode's price at this store.
 */
export async function saveGroceryTrip(input: TripInput): Promise<GroceryResult> {
  const store = clean(input.store, 60) || "Grocery";
  const receipt = roundCents(Number(input.receiptTotal));
  if (!(receipt > 0 && receipt <= MAX_AMOUNT)) return { error: "Type the total on your receipt." };
  if (!isValidDate(input.occurredOn)) return { error: "Pick a date." };
  if (input.budget !== null && !(input.budget > 0 && input.budget <= MAX_AMOUNT))
    return { error: "Check the trip budget." };
  if (input.items.length > 300) return { error: "That's a lot of items! Save at most 300." };
  const items = input.items.map((i) => ({
    barcode: i.barcode ? clean(i.barcode, 64) : null,
    name: clean(i.name, 80) || "Item",
    price: roundCents(Number(i.price)),
    qty: Math.round(Number(i.qty)),
  }));
  if (items.some((i) => !(i.price > 0 && i.price <= MAX_AMOUNT) || !(i.qty >= 1 && i.qty <= 999))) {
    return { error: "Check the prices and quantities." };
  }

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data: account } = await supabase
    .from("accounts")
    .select("type")
    .eq("id", input.accountId)
    .maybeSingle();
  const type = account?.type as AccountType | undefined;
  if (!type || !(isSpendable(type) || type === "credit_line"))
    return { error: "Pick what you paid with." };

  const txn = await supabase
    .from("transactions")
    .insert({
      type: "expense",
      amount: receipt,
      account_id: input.accountId,
      category: "groceries",
      note: `Groceries · ${store}`,
      occurred_on: input.occurredOn,
    })
    .select("id")
    .single();
  if (txn.error) return FAILED;
  // Deleting the expense cascades to the trip and its items.
  const undo = () => supabase.from("transactions").delete().eq("id", txn.data.id);

  const scanned = roundCents(items.reduce((sum, i) => sum + i.price * i.qty, 0));
  const trip = await supabase
    .from("grocery_trips")
    .insert({
      store,
      budget: input.budget,
      account_id: input.accountId,
      scanned_total: scanned,
      transaction_id: txn.data.id,
    })
    .select("id")
    .single();
  if (trip.error) {
    await undo();
    return FAILED;
  }

  // Price memory: keep the latest name for each barcode, add today's price.
  const named = new Map(items.filter((i) => i.barcode).map((i) => [i.barcode!, i]));
  let productIds = new Map<string, string>();
  if (named.size) {
    const products = await supabase
      .from("products")
      .upsert(
        [...named.values()].map((i) => ({ barcode: i.barcode, name: i.name })),
        { onConflict: "user_id,barcode" },
      )
      .select("id, barcode");
    if (products.error) {
      await undo();
      return FAILED;
    }
    productIds = new Map(products.data.map((p) => [p.barcode as string, p.id as string]));
    await supabase.from("product_prices").insert(
      [...named.values()].map((i) => ({
        product_id: productIds.get(i.barcode!),
        store,
        price: i.price,
      })),
    );
  }

  if (items.length) {
    const { error } = await supabase.from("grocery_items").insert(
      items.map((i) => ({
        trip_id: trip.data.id,
        product_id: i.barcode ? (productIds.get(i.barcode) ?? null) : null,
        name: i.name,
        price: i.price,
        qty: i.qty,
      })),
    );
    if (error) {
      await undo();
      return FAILED;
    }
  }

  refresh();
  return {};
}

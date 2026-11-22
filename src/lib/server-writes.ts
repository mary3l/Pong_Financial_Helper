import "server-only";
import { CUSTOM_PREFIX, isCategoryFor } from "@/lib/categories";

import type { signedInClient } from "@/lib/auth";
import { buildSchedule, catchUpDue, type PaymentRow } from "@/lib/installments";
import { isSpendable, roundCents, type AccountType } from "@/lib/money";

// Write helpers shared by Server Actions. Not actions themselves: they take
// the signed-in client from the action that calls them.

export type Client = NonNullable<Awaited<ReturnType<typeof signedInClient>>>;

/** A built-in category, or one of yours (Settings › Categories) of that type. */
export async function knownCategory(
  supabase: Client,
  type: "expense" | "income",
  key: string,
): Promise<boolean> {
  if (isCategoryFor(type, key)) return true;
  if (!key.startsWith(CUSTOM_PREFIX)) return false;
  const { data, error } = await supabase
    .from("user_categories")
    .select("key")
    .eq("type", type)
    .eq("key", key)
    .maybeSingle();
  return !error && Boolean(data);
}

/** Ends the note of a salary loan payment taken from a payday ("GSIS MPL 3 of 24 · from pay"). */
export const FROM_PAY = " · from pay";

/**
 * The wallet money comes from or lands in for a scheduled item: the one
 * saved with it if it's still in use, else your first cash, bank or e-wallet.
 * With `chosen` (picked in Mark paid), that one or null if it isn't a wallet in use.
 */
export async function pickWallet(
  supabase: Client,
  preferred: string | null,
  chosen?: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .eq("archived", false)
    .order("created_at");
  // Scheduled items are in pesos: never a dollar wallet ("*" works before migration 0017).
  const wallets = (data ?? []).filter(
    (a) => isSpendable(a.type as AccountType) && a.currency !== "USD",
  );
  if (chosen) return wallets.find((a) => a.id === chosen)?.id ?? null;
  return wallets.find((a) => a.id === preferred)?.id ?? wallets[0]?.id ?? null;
}

/** Saves an installment plan and its payments. Its id, or null if anything failed (nothing is left behind). */
export async function savePlan(
  supabase: Client,
  plan: {
    kind: "bnpl" | "loan";
    accountId: string;
    name: string;
    principal: number;
    months: number;
    payFromAccountId: string | null;
    sourceTxnId: string | null;
    /** Someone else pays it (migration 0019). */
    personId?: string | null;
    /** Your office takes its payments from your pay (migration 0025). Missing: from a wallet. */
    payBy?: "wallet" | "salary";
    rows: PaymentRow[];
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("installment_plans")
    .insert({
      kind: plan.kind,
      account_id: plan.accountId,
      name: plan.name,
      principal: plan.principal,
      fee_total: roundCents(plan.rows.reduce((sum, r) => sum + r.feePart, 0)),
      months: plan.months,
      first_due: plan.rows[0].dueOn,
      pay_from_account_id: plan.payFromAccountId,
      source_txn_id: plan.sourceTxnId,
      ...(plan.personId ? { person_id: plan.personId } : {}),
      ...(plan.payBy === "salary" ? { pay_by: "salary" } : {}),
    })
    .select("id")
    .single();
  if (error) return null;

  const payments = await supabase.from("scheduled_payments").insert(
    plan.rows.map((r) => ({
      plan_id: data.id,
      seq: r.seq,
      due_on: r.dueOn,
      amount: r.amount,
      principal_part: r.principalPart,
      fee_part: r.feePart,
    })),
  );
  if (payments.error) {
    await supabase.from("installment_plans").delete().eq("id", data.id);
    return null;
  }
  return data.id;
}

/**
 * Puts one purchase on a credit line on the bill it lands on, in one
 * payment, as Add does with no installment: a purchase that's past its bill
 * goes on the next one. Its due date when saved, else null.
 */
export async function billPurchase(
  supabase: Client,
  line: CreditTerms,
  purchase: { id: string; name: string; amount: number; occurredOn: string },
  today: string,
): Promise<string | null> {
  const amount = roundCents(purchase.amount);
  const dueOn = catchUpDue(purchase.occurredOn, line.dueDay, today, line.cutoffDay);
  const saved = await savePlan(supabase, {
    kind: "bnpl",
    accountId: line.id,
    name: purchase.name.slice(0, 60),
    principal: amount,
    months: 1,
    payFromAccountId: null,
    sourceTxnId: purchase.id,
    rows: buildSchedule({ principal: amount, feeTotal: 0, months: 1, firstDue: dueOn }),
  });
  return saved ? dueOn : null;
}

/** PostgREST says PGRST204 for a column it doesn't know, Postgres 42703: a migration hasn't been run. */
export function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

export type CreditTerms = {
  id: string;
  type: AccountType;
  dueDay: number | null;
  cutoffDay: number | null;
};

/** Each account's type, due day and statement cutoff (null before migration 0019). */
export async function creditTerms(supabase: Client, ids: string[]): Promise<CreditTerms[]> {
  if (!ids.length) return [];
  const read = (columns: string) => supabase.from("accounts").select(columns).in("id", ids);
  const first = await read("id, type, due_day, cutoff_day");
  const { data } = isMissingColumn(first.error) ? await read("id, type, due_day") : first;
  return (
    (data ?? []) as unknown as {
      id: string;
      type: string;
      due_day: number | null;
      cutoff_day?: number | null;
    }[]
  ).map((a) => ({
    id: a.id,
    type: a.type as AccountType,
    dueDay: a.due_day,
    cutoffDay: a.cutoff_day ?? null,
  }));
}

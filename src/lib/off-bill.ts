import { categoryInfo } from "@/lib/categories";
import type { InstallmentPlan, Transaction } from "@/lib/data";
import { catchUpDue } from "@/lib/installments";
import { roundCents } from "@/lib/money";
import { toSplitBill, type SplitBill } from "@/lib/splits";

// What you owe on a credit line that's on none of its bills: split bills
// saved before they made a plan, and purchases no plan was made from (a
// grocery trip before checkout made one, one moved onto the line in Edit).

export type OffBillSplit = SplitBill & { dueOn: string };
export type OffBillPurchase = {
  id: string;
  name: string;
  amount: number;
  occurredOn: string;
  dueOn: string;
};

export function offBill({
  owed,
  plans,
  splits,
  purchases,
  line,
  today,
}: {
  /** What you owe on the line now. */
  owed: number;
  plans: Pick<InstallmentPlan, "sourceTxnId" | "payments">[];
  /** The split bills paid with the line, by split id (getSplitsPaidWith). */
  splits: Map<string, Transaction[]>;
  /** Its purchases on no plan and in no split, newest first (getUnbilledPurchases). */
  purchases: Transaction[];
  line: { dueDay: number | null; cutoffDay: number | null };
  today: string;
}): { splits: OffBillSplit[]; purchases: OffBillPurchase[] } {
  const sources = new Set(plans.flatMap((p) => (p.sourceTxnId ? [p.sourceTxnId] : [])));
  const offSplits: OffBillSplit[] = [];
  for (const [splitId, records] of splits) {
    if (records.some((r) => sources.has(r.id))) continue;
    offSplits.push({
      ...toSplitBill(splitId, records),
      dueOn: catchUpDue(records[0].occurredOn, line.dueDay, today, line.cutoffDay),
    });
  }
  offSplits.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  // What you owe that no upcoming payment covers yet, after the splits: the newest
  // purchases it still holds. Older ones were paid off some other way.
  const scheduled = plans
    .flatMap((p) => p.payments)
    .filter((p) => !p.transactionId)
    .reduce((sum, p) => sum + p.principalPart, 0);
  let room = roundCents(
    Math.max(0, roundCents(owed - scheduled)) - offSplits.reduce((s, b) => s + b.total, 0),
  );
  const offPurchases: OffBillPurchase[] = [];
  for (const t of purchases) {
    if (sources.has(t.id) || t.splitId) continue;
    if (t.amount > room + 0.005) break;
    room = roundCents(room - t.amount);
    offPurchases.push({
      id: t.id,
      name: t.note || t.subcategory || categoryInfo("expense", t.category).label,
      amount: t.amount,
      occurredOn: t.occurredOn,
      dueOn: catchUpDue(t.occurredOn, line.dueDay, today, line.cutoffDay),
    });
  }
  return { splits: offSplits, purchases: offPurchases };
}

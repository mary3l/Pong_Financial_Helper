import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdjustmentEditor } from "@/components/adjust-balance";
import { AddTransactionSkeleton } from "@/components/add-transaction";
import { TransactionForm } from "@/components/transaction-form";
import { isAdjustment } from "@/lib/categories";
import { getAccounts, getSubcategories, getTransaction } from "@/lib/data";
import { today } from "@/lib/dates";

export const metadata = { title: "Edit · Pong Money" };

// Edit or delete one transaction from Activity.
export default function EditTransactionPage({ params }: PageProps<"/activity/[id]">) {
  return (
    <Suspense fallback={<AddTransactionSkeleton />}>
      <EditTransaction params={params} />
    </Suspense>
  );
}

async function EditTransaction({ params }: Pick<PageProps<"/activity/[id]">, "params">) {
  const { id } = await params;
  const [transaction, accounts, subcategories] = await Promise.all([
    getTransaction(id),
    getAccounts({ includeArchived: true, includePeople: true }),
    getSubcategories(),
  ]);
  if (!transaction) notFound();

  if (isAdjustment(transaction)) {
    return (
      <AdjustmentEditor
        transaction={transaction}
        walletName={accounts.find((a) => a.id === transaction.accountId)?.name ?? "Removed wallet"}
        closeHref={`/money/${transaction.accountId}?p=${transaction.occurredOn}`}
        today={today()}
      />
    );
  }

  // Archived wallets and people stay hidden unless this transaction used one.
  const used = (a: { id: string }) =>
    a.id === transaction.accountId || a.id === transaction.toAccountId;
  const usable = accounts.filter((a) => used(a) || (!a.archived && a.type !== "person"));

  const form = (
    <TransactionForm
      accounts={usable}
      templates={[]}
      transaction={transaction}
      subcategories={subcategories}
      today={today()}
      mode="page"
      closeHref={
        transaction.splitId
          ? `/activity/split/${transaction.splitId}`
          : `/activity?p=${transaction.occurredOn}`
      }
    />
  );
  if (!transaction.splitId) return form;
  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`/activity/split/${transaction.splitId}`}
        className="flex items-center justify-between gap-3 rounded-[18px] bg-sea-tint px-4 py-3 text-sm font-bold text-sea-dark"
      >
        <span>
          This is one share of a split bill. Changing it doesn&apos;t change the other shares.
        </span>
        <span className="shrink-0 font-extrabold underline">See the whole bill</span>
      </Link>
      {form}
    </div>
  );
}

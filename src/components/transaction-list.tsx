import Link from "next/link";
import { ChevronIcon, PathIcon } from "@/components/icons";
import { categoryInfo, categoryLabel, isAdjustment } from "@/lib/categories";
import type { Account, Transaction } from "@/lib/data";
import { formatRelativeDay, formatShortDay, transactionTime } from "@/lib/dates";
import { balanceEffect, formatMoney, formatPeso, type Currency } from "@/lib/money";
import { groupSplits, itemDate, type ListItem, type SplitBill } from "@/lib/splits";

/**
 * Transactions grouped under day headings, each opening its edit screen. A
 * split bill shows as one row that opens its breakdown.
 */
export function TransactionList({
  transactions,
  items,
  accounts,
  today,
  grouped = true,
  walletId,
}: {
  transactions: Transaction[];
  /** Already grouped (one page of a long list): shown instead of `transactions`. */
  items?: ListItem[];
  accounts: Account[];
  today: string;
  /** False for short lists that show the day on each row instead. */
  grouped?: boolean;
  /** Viewed from one wallet: transfers show as money in or out of it. */
  walletId?: string;
}) {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  // Amounts are in their wallet's currency: dollars on a USD time deposit.
  const currencies = new Map(accounts.map((a) => [a.id, a.currency]));
  const days: { date: string; items: ListItem[] }[] = [];
  for (const item of items ?? groupSplits(transactions)) {
    const date = itemDate(item);
    const last = days.at(-1);
    if (grouped && last?.date === date) last.items.push(item);
    else days.push({ date, items: [item] });
  }

  return (
    <div className="flex flex-col">
      {days.map((day) => (
        <section key={`${day.date}-${itemKey(day.items[0])}`} aria-label={grouped ? formatRelativeDay(day.date, today) : undefined}>
          {grouped && (
            <h3 className="pt-3 pb-1 text-[13px] font-extrabold text-muted uppercase">
              {formatRelativeDay(day.date, today)}
            </h3>
          )}
          <ul className="flex flex-col">
            {day.items.map((item) => (
              <li key={itemKey(item)}>
                {item.kind === "one" ? (
                  <TransactionRow txn={item.txn} names={names} currencies={currencies} today={grouped ? null : today} walletId={walletId} />
                ) : (
                  <SplitRow split={item.split} names={names} today={grouped ? null : today} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Previous / next page under a long list, with "Page 2 of 4". `href` makes
 * the link for a page; nothing shows when everything fits on one.
 */
export function ListPages({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const link = "flex h-11 items-center gap-1 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint";
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2 rounded-[20px] bg-card px-2 py-1.5">
      {page > 1 ? (
        <Link href={href(page - 1)} className={link} rel="prev">
          <ChevronIcon direction="left" size={18} /> Newer
        </Link>
      ) : (
        <span className="w-20" aria-hidden="true" />
      )}
      <span className="text-sm font-bold text-muted" aria-live="polite">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={link} rel="next">
          Older <ChevronIcon size={18} />
        </Link>
      ) : (
        <span className="w-20" aria-hidden="true" />
      )}
    </nav>
  );
}

/**
 * "Nov 5, 3:42 PM" under a day heading; "Yesterday, 3:42 PM" in short lists
 * with no headings (`today` set). Just the day if there's no time.
 */
function when(
  item: { occurredOn: string; occurredTime: string | null; createdAt: string | null },
  today: string | null,
): string {
  const day = today ? formatRelativeDay(item.occurredOn, today) : formatShortDay(item.occurredOn);
  return [day, transactionTime(item)].filter(Boolean).join(", ");
}

function itemKey(item: ListItem) {
  return item.kind === "one" ? item.txn.id : `split-${item.split.splitId}`;
}

/** One row for a whole split bill: your share is the spending, the bill total underneath. */
function SplitRow({
  split,
  names,
  today,
}: {
  split: SplitBill;
  names: Map<string, string>;
  today: string | null;
}) {
  const info = categoryInfo("expense", split.mine?.category ?? "family");
  const people = split.others.length;
  const detail = [
    split.mine ? info.label : null,
    names.get(split.accountId) ?? "Removed wallet",
    `split with ${people}`,
  ];
  detail.unshift(when(split, today));

  return (
    <Link
      href={`/activity/split/${split.splitId}`}
      className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-mint"
    >
      <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] ${info.tint}`}>
        <PathIcon d={info.icon} size={21} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">{split.title}</span>
        <span className="truncate text-[13px] text-muted">{detail.filter(Boolean).join(" · ")}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="font-display text-[17px] font-semibold">
          {split.mine ? `−${formatPeso(split.mine.amount)}` : formatPeso(0)}
        </span>
        <span className="text-xs text-muted">of {formatPeso(split.total)}</span>
      </span>
      <span className="sr-only">Split bill, see breakdown</span>
    </Link>
  );
}

function TransactionRow({
  txn,
  names,
  currencies,
  today,
  walletId,
}: {
  txn: Transaction;
  names: Map<string, string>;
  currencies: Map<string, Currency>;
  /** Set to show the day in the row. */
  today: string | null;
  walletId?: string;
}) {
  const info = categoryInfo(txn.type, txn.category);
  const from = names.get(txn.accountId) ?? "Removed wallet";
  const to = txn.toAccountId ? (names.get(txn.toAccountId) ?? "Removed wallet") : "";

  // Titled by the note, else the subcategory ("Jeep"), else the category.
  const title = txn.type === "transfer" ? `${from} → ${to}` : txn.note || txn.subcategory || info.label;
  const money = (value: number, accountId: string | null) => formatMoney(value, (accountId && currencies.get(accountId)) || "PHP");
  const detail =
    txn.type === "transfer"
      ? [
          txn.note || "Transfer",
          // Pesos to dollars (or back): what landed.
          txn.toAmount !== null && !walletId ? `${money(txn.toAmount, txn.toAccountId)} landed` : null,
          "not spending",
        ]
      : isAdjustment(txn)
        ? [txn.note ? info.label : null, from, "not spending"]
        : [txn.note ? categoryLabel(txn.type, txn.category, txn.subcategory) : txn.subcategory ? info.label : null, from];
  detail.unshift(when(txn, today));

  // A transfer is neutral in Activity, but from one wallet it's money in or out of it.
  const flow = walletId ? balanceEffect(txn, walletId) : txn.type === "income" ? 1 : txn.type === "expense" ? -1 : 0;
  // From one wallet, what moved in its currency; elsewhere what left the first wallet.
  const shown = walletId ? money(Math.abs(flow), walletId) : money(txn.amount, txn.accountId);
  const amount = flow < 0 ? `−${shown}` : flow > 0 ? `+${shown}` : shown;

  return (
    <Link
      href={`/activity/${txn.id}`}
      className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-mint"
    >
      <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] ${info.tint}`}>
        <PathIcon d={info.icon} size={21} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">{title}</span>
        <span className="truncate text-[13px] text-muted">{detail.filter(Boolean).join(" · ")}</span>
      </span>
      <span
        className={`shrink-0 font-display text-[17px] font-semibold ${
          flow > 0 ? "text-sea" : txn.type === "transfer" && !walletId ? "text-muted" : ""
        }`}
      >
        {amount}
      </span>
      <span className="sr-only">
        {txn.type === "transfer" ? "Transfer" : isAdjustment(txn) ? "Balance adjustment" : txn.type === "income" ? "Income" : "Expense"}, edit
      </span>
    </Link>
  );
}

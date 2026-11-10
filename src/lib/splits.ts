import type { Transaction } from "@/lib/data";
import { formatPeso, roundCents } from "@/lib/money";

// A split bill you paid is several records: the expense for your share and a
// transfer (pautang) to each person. They share a split_id (migration 0012),
// so lists can show the bill once and open its breakdown.

export type SplitBill = {
  splitId: string;
  /** Your share: the only part that's spending. Missing if your share was ₱0. */
  mine: Transaction | undefined;
  /** Each person's share, as a transfer to them. */
  others: Transaction[];
  /** The whole bill. */
  total: number;
  /** The note you typed, without "(my share)" / "Split:". "Split bill" if none. */
  title: string;
  /** The wallet it was paid from. */
  accountId: string;
  occurredOn: string;
  /** When it was logged. */
  createdAt: string | null;
  /** The time picked for it, if any. */
  occurredTime: string | null;
};

export type ListItem = { kind: "one"; txn: Transaction } | { kind: "split"; split: SplitBill };

/** The note typed in Add, from any record of the split; "" if none was. */
export function typedNote(records: { note: string | null }[]): string {
  for (const t of records) {
    const note = t.note?.trim() ?? "";
    const mine = note.match(/^(.*) \(my share\)$/);
    if (mine?.[1].trim()) return mine[1].trim();
    const theirs = note.match(/^Split: (.*)$/);
    if (theirs?.[1].trim()) return theirs[1].trim();
  }
  return "";
}

/** The split's name: its note, or "Split bill". */
export function splitNote(records: Transaction[]): string {
  return typedNote(records) || "Split bill";
}

export function toSplitBill(splitId: string, records: Transaction[]): SplitBill {
  const mine = records.find((t) => t.type === "expense");
  return {
    splitId,
    mine,
    others: records.filter((t) => t !== mine),
    total: roundCents(records.reduce((s, t) => s + t.amount, 0)),
    title: splitNote(records),
    accountId: (mine ?? records[0]).accountId,
    occurredOn: records[0].occurredOn,
    createdAt: records[0].createdAt,
    occurredTime: records[0].occurredTime,
  };
}

/**
 * What each pautang record still has unpaid. Payments go to a person, not to
 * one bill, so they clear the oldest pautang first: what's left of their
 * balance sits on the newest records. `transactions` must be newest first
 * (as getTransactions returns them).
 */
export function unpaidByRecord(people: { id: string; balance: number }[], transactions: Transaction[]): Map<string, number> {
  const unpaid = new Map<string, number>();
  for (const p of people) {
    let left = Math.max(0, p.balance);
    for (const t of transactions) {
      if (t.type !== "transfer" || t.toAccountId !== p.id) continue;
      const owed = roundCents(Math.min(t.amount, left));
      unpaid.set(t.id, owed);
      left = roundCents(left - owed);
    }
  }
  return unpaid;
}

/**
 * Folds the records of each split into one item, where the first of them
 * was. A split with only one record in the list stays a plain row.
 */
export function groupSplits(transactions: Transaction[]): ListItem[] {
  const bySplit = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.splitId) bySplit.set(t.splitId, [...(bySplit.get(t.splitId) ?? []), t]);
  }
  const items: ListItem[] = [];
  const done = new Set<string>();
  for (const t of transactions) {
    const records = t.splitId ? bySplit.get(t.splitId) : undefined;
    if (!t.splitId || !records || records.length < 2) {
      items.push({ kind: "one", txn: t });
    } else if (!done.has(t.splitId)) {
      done.add(t.splitId);
      items.push({ kind: "split", split: toSplitBill(t.splitId, records) });
    }
  }
  return items;
}

/** The day a list item shows under. */
export function itemDate(item: ListItem): string {
  return item.kind === "one" ? item.txn.occurredOn : item.split.occurredOn;
}

/** One page of a long list: its items, which page it is (1-based) and how many there are. */
export type ListPage = { items: ListItem[]; page: number; pages: number };

/** Rows per page in Activity. */
export const PER_PAGE = 30;

/**
 * Cuts a list (newest first, as groupSplits gives it) into pages of at most
 * `perPage` rows, keeping each day on one page where it fits: a day that
 * would spill over starts the next page instead. Only a day with more rows
 * than a whole page is cut (filling the page it starts on). `page` past
 * either end shows the nearest page.
 */
export function pageOfItems(items: ListItem[], page: number, perPage = PER_PAGE): ListPage {
  const size = Math.max(1, Math.floor(perPage));
  const days: ListItem[][] = [];
  for (const item of items) {
    const last = days.at(-1);
    if (last && itemDate(last[0]) === itemDate(item)) last.push(item);
    else days.push([item]);
  }
  const pages: ListItem[][] = [];
  let current: ListItem[] = [];
  for (const day of days) {
    // A day that fits on a page of its own starts one rather than being cut.
    if (current.length && current.length + day.length > size && day.length <= size) {
      pages.push(current);
      current = [];
    }
    let rest = day;
    // A day longer than a page is cut anyway: it fills this page, then whole pages.
    while (current.length + rest.length > size) {
      const room = size - current.length;
      pages.push([...current, ...rest.slice(0, room)]);
      current = [];
      rest = rest.slice(room);
    }
    current.push(...rest);
  }
  if (current.length) pages.push(current);
  const count = Math.max(1, pages.length);
  const at = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), count);
  return { items: pages[at - 1] ?? [], page: at, pages: count };
}

/** `?page=` as typed in the address bar: a whole number from 1, else 1. */
export function readPage(value: unknown): number {
  const n = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 1;
  return Math.max(1, n);
}

/** Someone being added to a split bill: an existing person, or a new name. */
export type NewShare = { personId: string | null; name: string; amount: number };

/**
 * What's wrong with the people being added to a split, or null if nothing:
 * each needs a name and a share above ₱0, and no one can be on the bill twice
 * (a typed name matches someone with that name, as saving does).
 */
export function newSharesProblem(added: NewShare[], onBill: { personId: string; name: string }[]): string | null {
  const key = (s: { personId: string | null; name: string }) =>
    s.personId ? `id:${s.personId}` : `name:${s.name.replace(/\s+/g, " ").trim().toLowerCase()}`;
  const seen = new Set<string>();
  for (const p of onBill) {
    seen.add(key(p));
    seen.add(key({ personId: null, name: p.name }));
  }
  for (const s of added) {
    const name = s.name.replace(/\s+/g, " ").trim();
    if (!s.personId && !name) return "Pick who to add, or type their name.";
    if (name.length > 60) return "Check the name (up to 60 characters).";
    if (!(s.amount > 0)) return name ? `Enter ${name}'s share.` : "Enter a share for each person you add.";
    const ids = [key(s), key({ personId: null, name })];
    if (ids.some((k) => seen.has(k))) return `${name || "They"} ${name ? "is" : "are"} already on this bill.`;
    for (const k of ids) seen.add(k);
  }
  return null;
}

/**
 * A split bill to send to the group: the total, each share and whether it's
 * paid back. `unpaid` is what each share still has unpaid (unpaidByRecord).
 */
export function billBreakdownText({
  split,
  names,
  unpaid,
  dateLabel,
  myName,
}: {
  split: SplitBill;
  /** Person id → name. */
  names: Map<string, string>;
  unpaid: Map<string, number>;
  /** "Oct 23". */
  dateLabel: string;
  myName: string | null;
}): string {
  const shares = split.others.map((t) => {
    const left = unpaid.get(t.id) ?? 0;
    const name = names.get(t.toAccountId ?? "") ?? "Someone";
    const status = left === 0 ? "paid ✓" : left < t.amount ? `${formatPeso(left)} left` : "unpaid";
    return `• ${name}: ${formatPeso(t.amount)} · ${status}`;
  });
  const stillOwed = roundCents(split.others.reduce((s, t) => s + (unpaid.get(t.id) ?? 0), 0));
  return [
    `${split.title} · ${dateLabel}`,
    `Total bill: ${formatPeso(split.total)}`,
    "",
    ...(split.mine ? [`• ${myName ?? "Me"}: ${formatPeso(split.mine.amount)}`] : []),
    ...shares,
    "",
    stillOwed > 0 ? `Still to pay: ${formatPeso(stillOwed)}. Salamat!` : "All paid. Salamat, everyone!",
  ].join("\n");
}

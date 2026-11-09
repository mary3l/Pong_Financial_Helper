import { formatShortDay } from "@/lib/dates";
import type { ForecastItem } from "@/lib/forecast";
import { balanceEffect, formatPeso, roundCents } from "@/lib/money";

// Utang and pautang (design canvas row 5). A person's balance is what they
// owe you (above 0) or what you owe them (below 0). Pure, so the server and
// the Add form share it. See 0006_people.sql.

export type EntryKind = "lend" | "borrow" | "split" | "payment" | "forgive";

export type PersonEntry = {
  transactionId: string;
  personId: string;
  kind: EntryKind;
  dueOn: string | null;
  countInForecast: boolean;
  splitTotal: number | null;
};

export type Person = {
  id: string;
  name: string;
  contact: string | null;
  /** Above 0: they owe you. Below 0: you owe them. */
  balance: number;
  entries: PersonEntry[];
};

/** When an open balance is due: the earliest promised date, if any. */
export function dueDate(person: Person): string | null {
  if (person.balance === 0) return null;
  const kinds: EntryKind[] = person.balance > 0 ? ["lend", "split"] : ["borrow", "split"];
  const dates = person.entries
    .filter((e) => kinds.includes(e.kind) && e.dueOn)
    .map((e) => e.dueOn!)
    .sort();
  return dates[0] ?? null;
}

/** Pautang past its promised date. */
export function isOverdue(person: Person, today: string): boolean {
  const due = dueDate(person);
  return person.balance > 0 && due !== null && due < today;
}

/**
 * Forecast items for people. Utang with a due date always counts: you'll
 * have to pay it. Pautang counts only when you turned on "Count it in my
 * forecast", and never once it's late: the app doesn't count on money until
 * it's paid back.
 */
export function personItems(people: Person[], from: string, until: string): ForecastItem[] {
  const items: ForecastItem[] = [];
  for (const p of people) {
    const due = dueDate(p);
    if (!due || due >= until) continue;
    if (p.balance < 0) {
      items.push(item(p, "utang", due));
    } else if (p.balance > 0 && due >= from && p.entries.some((e) => e.countInForecast && e.dueOn)) {
      items.push(item(p, "pautang", due));
    }
  }
  return items;
}

function item(p: Person, kind: "utang" | "pautang", dueOn: string): ForecastItem {
  return {
    key: `${kind}|${p.id}`,
    kind,
    flow: kind === "utang" ? "out" : "in",
    id: p.id,
    name: kind === "utang" ? `Pay back ${p.name}` : `${p.name} pays you back`,
    amount: Math.abs(p.balance),
    dueOn,
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
  };
}

export type Share = {
  /** Null for you. */
  personId: string | null;
  amount: number;
};

/** Splits a bill evenly between you and `others`; you absorb the rounding. */
export function equalShares(total: number, others: string[]): Share[] {
  const count = others.length + 1;
  const each = Math.floor((total / count) * 100) / 100;
  return [
    { personId: null, amount: roundCents(total - each * others.length) },
    ...others.map((personId) => ({ personId, amount: each })),
  ];
}

/**
 * What a split does to the ledger. If you paid, your share is an expense and
 * each other share becomes pautang. If someone else paid, only your share
 * matters: it's an expense, and utang to them.
 */
export function splitEffects(shares: Share[], paidBy: string | null) {
  const mine = shares.find((s) => s.personId === null)?.amount ?? 0;
  if (paidBy === null) {
    return {
      expense: mine,
      lent: shares.filter((s) => s.personId !== null && s.amount > 0) as { personId: string; amount: number }[],
      owed: 0,
    };
  }
  return { expense: mine, lent: [], owed: mine };
}

/** Their loans and purchases in your name (Tita Flora's MariLoan or Atome): the interest left and the next payment. */
export type InYourName = {
  /** Interest and fees in the payments left: they pay it to the lender, on top of what they owe you. */
  interest: number;
  /** Their earliest unpaid payment. */
  next: { dueOn: string; amount: number } | null;
};

export const NOTHING_IN_YOUR_NAME: InYourName = { interest: 0, next: null };

type PlanForPerson = {
  personId: string | null;
  payments: { dueOn: string; amount: number; feePart: number; transactionId: string | null }[];
};

/** What `personId` still pays on plans in your name. The next payment adds up everything due that day. */
export function inYourName(personId: string, plans: PlanForPerson[]): InYourName {
  const unpaid = plans
    .filter((p) => p.personId === personId)
    .flatMap((p) => p.payments)
    .filter((p) => !p.transactionId)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const first = unpaid[0]?.dueOn;
  return {
    interest: roundCents(unpaid.reduce((sum, p) => sum + p.feePart, 0)),
    next: first
      ? { dueOn: first, amount: roundCents(unpaid.filter((p) => p.dueOn === first).reduce((sum, p) => sum + p.amount, 0)) }
      : null,
  };
}

/** Pautang overdue, or a payment of theirs in your name that's late. */
export function isLate(person: Person, theirs: InYourName, today: string): boolean {
  return isOverdue(person, today) || (person.balance > 0 && theirs.next !== null && theirs.next.dueOn < today);
}

// ── Sendable breakdowns ─────────────────────────────────────────────────

/** A record that's still (partly) open with someone: what it was and what's left of it. */
export type OpenRecord = {
  transactionId: string;
  date: string;
  /** "Chatukchak", "Phone (on Atome)", "Cash". */
  label: string;
  /** The whole record. */
  amount: number;
  /** What's still unpaid of it. */
  left: number;
  /** A split: the whole bill it was a share of. */
  splitTotal: number | null;
};

type Txn = {
  id: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  accountId: string;
  toAccountId: string | null;
  note: string | null;
  occurredOn: string;
};

/** What a record was for, without the "Split: " / "(my share)" the app adds. */
function recordLabel(t: Txn, entry: PersonEntry | undefined): string {
  const note = (t.note ?? "").replace(/^Split: /, "").replace(/ \(my share\)$/, "").trim();
  if (note && !["Pautang", "Utang", "Split bill", "My share"].includes(note)) return note;
  if (entry?.kind === "split") return "Split bill";
  return entry?.kind === "borrow" ? "Borrowed" : "Cash";
}

/**
 * What's still open with a person, oldest first. Payments clear the oldest
 * records first, so what's left of their balance sits on the newest ones
 * (like unpaidByRecord). `history` must be newest first.
 */
export function openRecords(person: Person, history: Txn[]): OpenRecord[] {
  const sign = Math.sign(person.balance);
  if (!sign) return [];
  const entries = new Map(person.entries.map((e) => [e.transactionId, e]));
  let left = Math.abs(person.balance);
  const open: OpenRecord[] = [];
  for (const t of history) {
    if (left <= 0) break;
    const entry = entries.get(t.id);
    if (entry?.kind === "payment" || entry?.kind === "forgive") continue;
    if (Math.sign(balanceEffect(t, person.id)) !== sign) continue;
    const unpaid = roundCents(Math.min(t.amount, left));
    left = roundCents(left - unpaid);
    open.push({
      transactionId: t.id,
      date: t.occurredOn,
      label: recordLabel(t, entry),
      amount: t.amount,
      left: unpaid,
      splitTotal: entry?.splitTotal ?? null,
    });
  }
  return open.reverse();
}

/**
 * A breakdown to send someone: each open item, what's left of it, and the
 * total. Pautang asks them to pay; utang tells them what you'll send.
 * `extra` lines go after the items, like each loan in your name they pay.
 * `theirs`: what they also pay a lender on loans or credit lines in your
 * name (Tita Flora's MariLoan). The interest is theirs, so it's in the
 * total, and their next payment is when it's due.
 */
export function breakdownText({
  person,
  open,
  today,
  myName,
  extra = [],
  theirs = NOTHING_IN_YOUR_NAME,
}: {
  person: Person;
  open: OpenRecord[];
  today: string;
  myName: string | null;
  extra?: string[];
  theirs?: InYourName;
}): string {
  const owesMe = person.balance > 0;
  const lines = open.map((r) => {
    const part = r.left < r.amount ? `${formatPeso(r.left)} left of ${formatPeso(r.amount)}` : formatPeso(r.left);
    const share = r.splitTotal ? ` (${owesMe ? "your" : "my"} share of ${formatPeso(r.splitTotal)})` : "";
    return `• ${formatShortDay(r.date, today)} · ${r.label}: ${part}${share}`;
  });
  const owed = Math.abs(person.balance);
  const theirInterest = owesMe ? roundCents(theirs.interest) : 0;
  const total =
    theirInterest > 0
      ? `${formatPeso(roundCents(owed + theirInterest))} (${formatPeso(owed)} + ${formatPeso(theirInterest)} interest & fees)`
      : formatPeso(owed);
  const due = dueDate(person);
  const next = owesMe ? theirs.next : null;
  // A loan in your name: its next payment. Otherwise the date they promised.
  const when = next
    ? `Next payment: ${formatPeso(next.amount)} ${next.dueOn < today ? "was due" : "due"} ${formatShortDay(next.dueOn, today)}`
    : owesMe && due
      ? `${due < today ? "Was due" : "Due"} ${formatShortDay(due, today)}`
      : null;
  return [
    owesMe ? `Hi ${person.name}! Here's the breakdown of what's still open:` : `Hi ${person.name}! Here's what I still owe you:`,
    "",
    ...lines,
    ...(extra.length ? ["", "Monthly payments:", ...extra.map((e) => `• ${e}`)] : []),
    "",
    `Total: ${total}`,
    ...(when ? [when] : []),
    owesMe ? `Salamat!${myName ? ` - ${myName}` : ""}` : `I'll send it soon. Salamat!${myName ? ` - ${myName}` : ""}`,
  ].join("\n");
}

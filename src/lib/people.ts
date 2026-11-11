import { addDays, formatShortDay, monthContaining } from "@/lib/dates";
import type { ForecastItem } from "@/lib/forecast";
import { catchUpDue } from "@/lib/installments";
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
  /** Bought on your credit line (Atome): the bill it's on, and when to ask them to pay. */
  card: CardBill | null;
};

/** Ask to be paid this many days before the card's due date, so the money's in before the bill. */
export const PAY_AHEAD_DAYS = 2;

/** A record bought on your credit line: which line, its bill's due date, and when you expect their payment. */
export type CardBill = { line: string; dueOn: string; expectedOn: string };

type CreditLine = { id: string; name: string; dueDay: number | null; cutoffDay: number | null };

type PlanOnLine = {
  sourceTxnId: string | null;
  personId: string | null;
  months: number;
  payments: { dueOn: string; transactionId: string | null }[];
};

/**
 * The card bill each record bought on your credit line is on, by record id.
 * Added to a bill (Add to bill): that bill's due date. Not yet: the bill the
 * statement cutoff puts it on (bought on or before the cutoff, this
 * statement; after it, the next), or the next bill if that one's passed,
 * like the credit line's page. Plans they pay in your name (Tita Flora's) and
 * installments are left out: their own payments show their dates. `splits`
 * is each split's record ids, to find the plan a split bill made.
 */
export function cardBills({
  records,
  lines,
  plans,
  splits,
  today,
}: {
  records: { id: string; accountId: string; occurredOn: string; splitId: string | null }[];
  lines: CreditLine[];
  plans: PlanOnLine[];
  splits: Map<string, string[]>;
  today: string;
}): Map<string, CardBill> {
  const out = new Map<string, CardBill>();
  for (const t of records) {
    const line = lines.find((l) => l.id === t.accountId);
    if (!line?.dueDay) continue;
    const ids = new Set([t.id, ...(t.splitId ? (splits.get(t.splitId) ?? []) : [])]);
    const plan = plans.find((p) => p.sourceTxnId && ids.has(p.sourceTxnId));
    if (plan && (plan.personId || plan.months > 1)) continue;
    const dueOn = plan
      ? plan.payments.find((x) => !x.transactionId)?.dueOn
      : catchUpDue(t.occurredOn, line.dueDay, today, line.cutoffDay);
    // A bill already paid: nothing more to ask by.
    if (!dueOn) continue;
    out.set(t.id, { line: line.name, dueOn, expectedOn: addDays(dueOn, -PAY_AHEAD_DAYS) });
  }
  return out;
}

/** "expected on Nov 14", "expected today", "was expected on Oct 14". Never the card's due date. */
export function expectedText(card: CardBill, today: string): string {
  if (card.dueOn < today) return `was expected on ${formatShortDay(card.expectedOn, today)}`;
  if (card.expectedOn <= today) return "expected today";
  return `expected on ${formatShortDay(card.expectedOn, today)}`;
}

/** The earliest card date among open records, to lead with; null if none is on a card. */
export function firstExpected(open: OpenRecord[]): CardBill | null {
  return open.reduce<CardBill | null>((first, r) => (r.card && (!first || r.card.expectedOn < first.expectedOn) ? r.card : first), null);
}

/** True when the open records are on cards with more than one date, so each row needs its own. */
export function datesDiffer(open: OpenRecord[]): boolean {
  return new Set(open.flatMap((r) => (r.card ? [r.card.expectedOn] : []))).size > 1;
}

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
export function openRecords(person: Person, history: Txn[], cards: Map<string, CardBill> = new Map()): OpenRecord[] {
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
      // Only what they owe you: your card, their part of the bill.
      card: sign > 0 ? (cards.get(t.id) ?? null) : null,
    });
  }
  return open.reverse();
}

/** A loan or purchase in your name that they pay (Tita Flora's MariLoan), with its unpaid payments. */
export type TheirPlan = {
  /** "My MariLoan loan", "Phone on my Atome". */
  label: string;
  /** Unpaid payments, interest or fees included. */
  payments: { amount: number; dueOn: string; /** "3 of 6", or null for a single payment. */ which: string | null }[];
};

export type DuePayment = { label: string; amount: number; dueOn: string; which: string | null; late: boolean };

/** What they pay this calendar month on plans in your name. */
export type MonthDue = {
  /** "November". */
  month: string;
  /** Late payments and those due by the end of the month, oldest first. */
  items: DuePayment[];
  total: number;
  /** The part of `total` that's already late. */
  late: number;
  /** Their first payment after this month. */
  next: DuePayment | null;
};

/**
 * This month's bill on loans and credit lines in your name: every unpaid
 * payment due by the end of the month (Philippine time), late ones included,
 * and the first one after it.
 */
export function dueThisMonth(plans: TheirPlan[], today: string): MonthDue {
  const end = monthContaining(today).end;
  const all = plans
    .flatMap((p) => p.payments.map((x) => ({ label: p.label, amount: x.amount, dueOn: x.dueOn, which: x.which, late: x.dueOn < today })))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.label.localeCompare(b.label));
  const items = all.filter((x) => x.dueOn <= end);
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(Date.parse(`${today}T00:00:00Z`)),
    items,
    total: roundCents(items.reduce((sum, x) => sum + x.amount, 0)),
    late: roundCents(items.filter((x) => x.late).reduce((sum, x) => sum + x.amount, 0)),
    next: all.find((x) => x.dueOn > end) ?? null,
  };
}

/** "₱2,820.83 due Nov 12 (3 of 6)" or "₱500 was due Oct 12, late". */
export function duePaymentText(p: DuePayment, today: string): string {
  return `${formatPeso(p.amount)} ${p.late ? "was due" : "due"} ${formatShortDay(p.dueOn, today)}${p.which ? ` (${p.which})` : ""}${p.late ? ", late" : ""}`;
}

/**
 * A breakdown to send someone. Someone paying loans or credit lines in your
 * name (`month`, from dueThisMonth) gets this month's bill first: each
 * payment due, late ones too, and what to pay this month; then everything
 * still open, with the interest they pay the lender, as the total in all.
 * Anyone else gets each open item, what's left of it, and the total.
 * Pautang asks them to pay; utang tells them what you'll send.
 */
export function breakdownText({
  person,
  open,
  today,
  myName,
  month = null,
  theirs = NOTHING_IN_YOUR_NAME,
}: {
  person: Person;
  open: OpenRecord[];
  today: string;
  myName: string | null;
  month?: MonthDue | null;
  /** What they also pay a lender on plans in your name: the interest is theirs, so it's in the total. */
  theirs?: InYourName;
}): string {
  const owesMe = person.balance > 0;
  // The card date closes the message only when nothing else does (this month's
  // bill, a loan's next payment, the date they promised); otherwise each row has it.
  const cardCloses = owesMe && !month && !theirs.next && !dueDate(person);
  const eachDate = !cardCloses || datesDiffer(open);
  const lines = open.map((r) => {
    const part = r.left < r.amount ? `${formatPeso(r.left)} left of ${formatPeso(r.amount)}` : formatPeso(r.left);
    const share = r.splitTotal ? ` (${owesMe ? "your" : "my"} share of ${formatPeso(r.splitTotal)})` : "";
    const card = r.card ? ` · on my ${r.card.line}${eachDate ? `, ${expectedText(r.card, today)}` : ""}` : "";
    return `• ${formatShortDay(r.date, today)} · ${r.label}: ${part}${share}${card}`;
  });
  const onCard = firstExpected(open);
  const cardWhen = onCard ? capitalize(expectedText(onCard, today)) : null;
  const owed = Math.abs(person.balance);
  const theirInterest = owesMe ? roundCents(theirs.interest) : 0;
  const thanks = owesMe ? `Salamat!${myName ? ` - ${myName}` : ""}` : `I'll send it soon. Salamat!${myName ? ` - ${myName}` : ""}`;

  if (owesMe && month) {
    const lead = month.items.length
      ? [
          `Hi ${person.name}! Here's what's due this ${month.month}:`,
          "",
          ...month.items.map((p) => `• ${p.label}: ${duePaymentText(p, today)}`),
          "",
          `To pay this month: ${formatPeso(month.total)}${month.late > 0 ? ` (${formatPeso(month.late)} of it is late)` : ""}`,
        ]
      : [
          `Hi ${person.name}! Nothing more to pay this ${month.month}.`,
          ...(month.next ? [`Next payment: ${duePaymentText(month.next, today)} · ${month.next.label}`] : []),
        ];
    return [
      ...lead,
      "",
      `Still open in all: ${formatPeso(roundCents(owed + theirInterest))}`,
      ...lines,
      ...(theirInterest > 0 ? [`• Interest & fees in the payments left: ${formatPeso(theirInterest)}`] : []),
      "",
      thanks,
    ].join("\n");
  }

  const total =
    theirInterest > 0
      ? `${formatPeso(roundCents(owed + theirInterest))} (${formatPeso(owed)} + ${formatPeso(theirInterest)} interest & fees)`
      : formatPeso(owed);
  const due = dueDate(person);
  const next = owesMe ? theirs.next : null;
  // A loan in your name: its next payment. Otherwise the date they promised, or when your card needs it.
  const when = next
    ? `Next payment: ${formatPeso(next.amount)} ${next.dueOn < today ? "was due" : "due"} ${formatShortDay(next.dueOn, today)}`
    : owesMe && due
      ? `${due < today ? "Was due" : "Due"} ${formatShortDay(due, today)}`
      : cardWhen;
  return [
    owesMe ? `Hi ${person.name}! Here's the breakdown of what's still open:` : `Hi ${person.name}! Here's what I still owe you:`,
    "",
    ...lines,
    "",
    `Total: ${total}`,
    ...(when ? [when] : []),
    thanks,
  ].join("\n");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

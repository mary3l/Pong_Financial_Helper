import type { PongMood } from "@/components/pong";
import { formatShortDay } from "@/lib/dates";
import { formatPeso, roundCents } from "@/lib/money";
import { datesDiffer, dueDate, expectedText, firstExpected, type InYourName, type MonthDue, type OpenRecord, type Person } from "@/lib/people";
import type { SplitBill } from "@/lib/splits";

// The breakdown as a receipt card: what Send image draws as a PNG, next to
// the plain text for Copy text (breakdownText, billBreakdownText). Pure, so
// it's easy to test; the drawing is in components/receipt-image.ts.

export type ReceiptRow = {
  label: string;
  /** Smaller lines under the label. */
  details: string[];
  amount: string;
  /** Paid back, partly paid, or not paid yet. */
  tone?: "paid" | "part" | "open";
  /** A pill under the amount: "PAID", "UNPAID", "₱300 LEFT". */
  badge?: string;
};

export type Receipt = {
  /** How Pong looks on the card. */
  mood: PongMood;
  /** What Pong says in his speech bubble. */
  bubble: string;
  /** Small caps over the title: "WHAT'S STILL OPEN". */
  kicker: string;
  title: string;
  subtitle: string;
  /**
   * The headline amount, right under the title: what to pay this month.
   * With one, the total at the bottom is drawn smaller, as the total in all.
   */
  lead: { label: string; amount: string; detail: string | null; late: boolean } | null;
  /** A section with an empty heading is drawn without one. */
  sections: { heading: string; rows: ReceiptRow[] }[];
  total: { label: string; amount: string; detail: string | null };
  /** "Next payment: ₱2,400 due Nov 16". */
  note: { text: string; late: boolean } | null;
  footer: string;
};

const signOff = (text: string, myName: string | null) => `${text}${myName ? ` — ${myName}` : ""}`;

/**
 * One open record as a row: when, what it was a share of, how much is paid,
 * and the card it's on (with its date when `eachDate`: rows differ, or
 * nothing else on the card says it).
 */
function openRow(r: OpenRecord, owesMe: boolean, today: string, eachDate: boolean): ReceiptRow {
  const card = r.card ? `On my ${r.card.line}${eachDate ? ` · ${expectedText(r.card, today)}` : ""}` : null;
  return {
    label: r.label,
    details: [
      [formatShortDay(r.date, today), r.splitTotal ? `${owesMe ? "your" : "my"} share of ${formatPeso(r.splitTotal)}` : null]
        .filter(Boolean)
        .join(" · "),
      ...(r.left < r.amount ? [`${formatPeso(r.amount - r.left)} of ${formatPeso(r.amount)} paid`] : []),
      ...(card ? [card] : []),
    ],
    amount: formatPeso(r.left),
    tone: r.left < r.amount ? "part" : undefined,
  };
}

/**
 * A person's breakdown. Someone paying loans or credit lines in your name
 * (`month`, from dueThisMonth) gets this month's bill as the headline: each
 * payment due this month, late ones marked, then what's still open in all,
 * interest included, smaller underneath. Anyone else: each open item and
 * the total.
 */
export function personReceipt({
  person,
  open,
  month = null,
  theirs,
  today,
  myName,
}: {
  person: Person;
  open: OpenRecord[];
  month?: MonthDue | null;
  theirs: InYourName;
  today: string;
  myName: string | null;
}): Receipt {
  const owesMe = person.balance > 0;
  const owed = Math.abs(person.balance);
  const interest = owesMe ? roundCents(theirs.interest) : 0;
  const due = dueDate(person);
  const footer = owesMe ? signOff("Salamat!", myName) : signOff("I'll send it soon. Salamat!", myName);

  if (owesMe && month) {
    const late = month.late > 0;
    const lastDue = month.items.at(-1)?.dueOn;
    const stillOpen: ReceiptRow[] = [
      ...open.map((r) => openRow(r, true, today, true)),
      ...(interest > 0 ? [{ label: "Interest & fees", details: ["In the payments left, paid to the lender"], amount: formatPeso(interest) }] : []),
    ];
    return {
      mood: late ? "worried" : "ask",
      bubble: late ? "Paalala lang po!" : "Pa-remind lang po!",
      kicker: `THIS ${month.month.toUpperCase()}`,
      title: person.name,
      subtitle: `As of ${formatShortDay(today, today)}`,
      lead: month.items.length
        ? {
            label: "To pay this month",
            amount: formatPeso(month.total),
            detail: late
              ? `${formatPeso(month.late)} of it is late`
              : lastDue
                ? `Due by ${formatShortDay(lastDue, today)}`
                : null,
            late,
          }
        : month.next
          ? {
              label: "Next payment",
              amount: formatPeso(month.next.amount),
              detail: `Due ${formatShortDay(month.next.dueOn, today)} · nothing more this ${month.month}`,
              late: false,
            }
          : null,
      sections: [
        ...(month.items.length
          ? [
              {
                heading: "",
                rows: month.items.map((p) => ({
                  label: p.label,
                  details: [`${p.late ? "Was due" : "Due"} ${formatShortDay(p.dueOn, today)}${p.which ? ` · ${p.which}` : ""}`],
                  amount: formatPeso(p.amount),
                  tone: p.late ? ("open" as const) : undefined,
                  badge: p.late ? "LATE" : undefined,
                })),
              },
            ]
          : []),
        { heading: "Everything still open", rows: stillOpen },
      ],
      total: {
        label: "Total still open",
        amount: formatPeso(roundCents(owed + interest)),
        detail: interest > 0 ? `${formatPeso(owed)} + ${formatPeso(interest)} interest & fees` : null,
      },
      note: null,
      footer,
    };
  }

  const next = owesMe ? theirs.next : null;
  // Bought on your card: when you expect their payment, a couple of days before the bill.
  const onCard = owesMe && !next && !due ? firstExpected(open) : null;
  const cardLate = Boolean(onCard && onCard.dueOn < today);
  const late = Boolean((next && next.dueOn < today) || (owesMe && !next && due && due < today) || cardLate);
  return {
    mood: !owesMe ? "listen" : late ? "worried" : "ask",
    bubble: !owesMe ? "Babayaran ko po!" : late ? "Paalala lang po!" : "Pa-remind lang po!",
    kicker: owesMe ? "WHAT'S STILL OPEN" : "WHAT I STILL OWE YOU",
    title: person.name,
    subtitle: `As of ${formatShortDay(today, today)}`,
    lead: null,
    // No heading: the kicker already says what these are.
    sections: [{ heading: "", rows: open.map((r) => openRow(r, owesMe, today, !onCard || datesDiffer(open))) }],
    total: {
      label: "Total",
      amount: formatPeso(roundCents(owed + interest)),
      detail: interest > 0 ? `${formatPeso(owed)} + ${formatPeso(interest)} interest & fees` : null,
    },
    note: next
      ? { text: `Next payment ${formatPeso(next.amount)} ${next.dueOn < today ? "was due" : "due"} ${formatShortDay(next.dueOn, today)}`, late: next.dueOn < today }
      : owesMe && due
        ? { text: `${due < today ? "Was due" : "Due"} ${formatShortDay(due, today)}`, late: due < today }
        : onCard
          ? { text: capitalize(expectedText(onCard, today)), late: cardLate }
          : null,
    footer,
  };
}

/** A split bill for the group: every share and whether it's paid back. */
export function billReceipt({
  split,
  names,
  unpaid,
  dateLabel,
  wallet,
  myName,
}: {
  split: SplitBill;
  names: Map<string, string>;
  unpaid: Map<string, number>;
  dateLabel: string;
  /** What it was paid with. */
  wallet: string;
  myName: string | null;
}): Receipt {
  const stillOwed = roundCents(split.others.reduce((s, t) => s + (unpaid.get(t.id) ?? 0), 0));
  const rows: ReceiptRow[] = [
    ...(split.mine ? [{ label: myName ?? "Me", details: ["Paid the bill"], amount: formatPeso(split.mine.amount) }] : []),
    ...split.others.map((t) => {
      const left = unpaid.get(t.id) ?? 0;
      return {
        label: names.get(t.toAccountId ?? "") ?? "Someone",
        details: [left === 0 ? "Paid back" : left < t.amount ? `${formatPeso(t.amount - left)} paid so far` : "Not paid yet"],
        amount: formatPeso(t.amount),
        tone: left === 0 ? ("paid" as const) : left < t.amount ? ("part" as const) : ("open" as const),
        badge: left === 0 ? "PAID" : left < t.amount ? `${formatPeso(left)} LEFT` : "UNPAID",
      };
    }),
  ];
  return {
    mood: stillOwed > 0 ? "happy" : "proud",
    bubble: stillOwed > 0 ? "Hatian na tayo!" : "Bayad na lahat!",
    kicker: "SPLIT BILL",
    title: split.title,
    subtitle: `${dateLabel} · paid with ${wallet}`,
    lead: null,
    sections: [{ heading: `${rows.length} shares`, rows }],
    total: stillOwed > 0
      ? { label: "Still to pay", amount: formatPeso(stillOwed), detail: `Total bill ${formatPeso(split.total)}` }
      : { label: "Total bill", amount: formatPeso(split.total), detail: "Everyone has paid" },
    note: null,
    footer: signOff("Salamat!", myName),
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

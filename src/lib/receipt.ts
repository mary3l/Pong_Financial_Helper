import type { PongMood } from "@/components/pong";
import { formatShortDay } from "@/lib/dates";
import { formatPeso, roundCents } from "@/lib/money";
import { dueDate, type InYourName, type OpenRecord, type Person } from "@/lib/people";
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
  /** A section with an empty heading is drawn without one. */
  sections: { heading: string; rows: ReceiptRow[] }[];
  total: { label: string; amount: string; detail: string | null };
  /** "Next payment: ₱2,400 due Nov 16". */
  note: { text: string; late: boolean } | null;
  footer: string;
};

/** A loan or purchase in your name that they pay (Tita Flora's MariLoan), for the breakdown. */
export type PlanLine = {
  /** "My MariLoan loan", "Phone on my Atome". */
  label: string;
  next: { amount: number; dueOn: string };
  /** "3 of 6", or null for a single payment. */
  which: string | null;
  /** Payments left. */
  payments: number;
  /** Principal + interest left. */
  left: number;
  principal: number;
  interest: number;
  /** A loan's is interest; a credit line's, fees. */
  interestWord: "interest" | "fees";
};

/** One plan as a line of the text breakdown. */
export function planLineText(p: PlanLine, today: string): string {
  const parts = p.interest > 0 ? ` (${formatPeso(p.principal)} + ${formatPeso(p.interest)} ${p.interestWord})` : "";
  return `${p.label}: ${formatPeso(p.next.amount)} due ${formatShortDay(p.next.dueOn, today)}${p.which ? ` (${p.which})` : ""}. ${formatPeso(p.left)} left${parts}, ${p.payments === 1 ? "1 payment" : `${p.payments} payments`}`;
}

const signOff = (text: string, myName: string | null) => `${text}${myName ? ` — ${myName}` : ""}`;

/** A person's breakdown: each open item, their plans in your name, and the total with interest. */
export function personReceipt({
  person,
  open,
  plans = [],
  theirs,
  today,
  myName,
}: {
  person: Person;
  open: OpenRecord[];
  plans?: PlanLine[];
  theirs: InYourName;
  today: string;
  myName: string | null;
}): Receipt {
  const owesMe = person.balance > 0;
  const owed = Math.abs(person.balance);
  const interest = owesMe ? roundCents(theirs.interest) : 0;
  const due = dueDate(person);
  const next = owesMe ? theirs.next : null;
  const sections: Receipt["sections"] = [
    {
      // No heading: the kicker already says what these are.
      heading: "",
      rows: open.map((r) => ({
        label: r.label,
        details: [
          [formatShortDay(r.date, today), r.splitTotal ? `${owesMe ? "your" : "my"} share of ${formatPeso(r.splitTotal)}` : null]
            .filter(Boolean)
            .join(" · "),
          ...(r.left < r.amount ? [`${formatPeso(r.amount - r.left)} of ${formatPeso(r.amount)} paid`] : []),
        ],
        amount: formatPeso(r.left),
        tone: r.left < r.amount ? ("part" as const) : undefined,
      })),
    },
  ];
  if (owesMe && plans.length) {
    sections.push({
      heading: "Monthly payments",
      rows: plans.map((p) => ({
        label: p.label,
        details: [
          `Next ${formatPeso(p.next.amount)} due ${formatShortDay(p.next.dueOn, today)}${p.which ? ` · ${p.which}` : ""}`,
          `${p.payments === 1 ? "1 payment" : `${p.payments} payments`} left${p.interest > 0 ? ` · ${formatPeso(p.principal)} + ${formatPeso(p.interest)} ${p.interestWord}` : ""}`,
        ],
        amount: formatPeso(p.left),
        tone: p.next.dueOn < today ? ("open" as const) : undefined,
      })),
    });
  }
  const late = Boolean((next && next.dueOn < today) || (owesMe && !next && due && due < today));
  return {
    mood: !owesMe ? "listen" : late ? "worried" : "ask",
    bubble: !owesMe ? "Babayaran ko po!" : late ? "Paalala lang po!" : "Pa-remind lang po!",
    kicker: owesMe ? "WHAT'S STILL OPEN" : "WHAT I STILL OWE YOU",
    title: person.name,
    subtitle: `As of ${formatShortDay(today, today)}`,
    sections,
    total: {
      label: "Total",
      amount: formatPeso(roundCents(owed + interest)),
      detail: interest > 0 ? `${formatPeso(owed)} + ${formatPeso(interest)} interest & fees` : null,
    },
    note: next
      ? { text: `Next payment ${formatPeso(next.amount)} ${next.dueOn < today ? "was due" : "due"} ${formatShortDay(next.dueOn, today)}`, late: next.dueOn < today }
      : owesMe && due
        ? { text: `${due < today ? "Was due" : "Due"} ${formatShortDay(due, today)}`, late: due < today }
        : null,
    footer: owesMe ? signOff("Salamat!", myName) : signOff("I'll send it soon. Salamat!", myName),
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
    sections: [{ heading: `${rows.length} shares`, rows }],
    total: stillOwed > 0
      ? { label: "Still to pay", amount: formatPeso(stillOwed), detail: `Total bill ${formatPeso(split.total)}` }
      : { label: "Total bill", amount: formatPeso(split.total), detail: "Everyone has paid" },
    note: null,
    footer: signOff("Salamat!", myName),
  };
}

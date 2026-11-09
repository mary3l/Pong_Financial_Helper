import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { ShareText } from "@/components/share-text";
import { getAccounts, getInstallmentPlans, getPeople, getTransactions } from "@/lib/data";
import { formatShortDay, today as getToday } from "@/lib/dates";
import { dueText } from "@/lib/installments";
import { balanceEffect, formatPeso, paysInPesos, roundCents } from "@/lib/money";
import { breakdownText, dueDate, inYourName, isLate, openRecords, type PersonEntry } from "@/lib/people";
import { personReceipt, planLineText, type PlanLine } from "@/lib/receipt";
import { TheyPaidButton } from "../../[id]/account-actions";
import { Avatar } from "../avatar";
import { EditPerson, ForgiveButton, PaymentForm } from "../person-actions";

export const metadata = { title: "Person · Pong Money" };

// Design canvas 5.3: the balance with one person, Record payment, Send
// reminder, history, and Forgive remaining balance.
export default function PersonPage({ params }: PageProps<"/money/people/[id]">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl">
      <Link href="/money/people" className="flex h-10 w-fit items-center font-extrabold text-sea-dark">‹ Utang &amp; pautang</Link>
      <Suspense fallback={<div className="h-[560px] rounded-[20px] bg-line-soft" />}>
        <PersonDetail params={params} />
      </Suspense>
    </div>
  );
}

const KIND_LABELS: Record<PersonEntry["kind"], string> = {
  lend: "Lent",
  borrow: "Borrowed",
  split: "Split",
  payment: "Paid back",
  forgive: "Forgiven",
};

async function PersonDetail({ params }: Pick<PageProps<"/money/people/[id]">, "params">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [people, accounts, history, user, allPlans] = await Promise.all([
    getPeople({ includeArchived: true }),
    getAccounts({ includeArchived: true }),
    getTransactions({ accountId: id, limit: 100 }),
    getCurrentUser(),
    getInstallmentPlans(),
  ]);
  const person = people.find((p) => p.id === id);
  if (!person) notFound();

  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const wallets = accounts.filter((a) => paysInPesos(a) && !a.archived);
  const due = dueDate(person);
  const theirs = inYourName(person.id, allPlans);
  const late = isLate(person, theirs, today);
  const owesYou = person.balance > 0;
  // Their purchases and loans in your name (Tita Flora on your Atome or MariLoan), with the next payment of each.
  const onYourLines = allPlans
    .filter((p) => p.personId === person.id)
    .map((plan) => {
      const unpaid = plan.payments.filter((p) => !p.transactionId);
      return {
        plan,
        next: unpaid[0],
        unpaid,
        left: roundCents(unpaid.reduce((sum, p) => sum + p.amount, 0)),
        principal: roundCents(unpaid.reduce((sum, p) => sum + p.principalPart, 0)),
        interest: roundCents(unpaid.reduce((sum, p) => sum + p.feePart, 0)),
      };
    })
    .filter((p) => p.next);
  // They pay the lender this on top of what they owe you: theirs, never your expense.
  const interestLeft = roundCents(onYourLines.reduce((sum, p) => sum + p.interest, 0));
  const open = openRecords(person, history);
  const theirPlans: PlanLine[] = onYourLines.map(({ plan, next, unpaid, left, principal, interest }) => {
    const lender = names.get(plan.accountId) ?? (plan.kind === "loan" ? "loan" : "credit line");
    return {
      label: plan.kind === "loan" ? `My ${lender} loan` : `${plan.name} on my ${lender}`,
      next: { amount: next!.amount, dueOn: next!.dueOn },
      which: plan.months > 1 ? `${next!.seq} of ${plan.months}` : null,
      payments: unpaid.length,
      left,
      principal,
      interest,
      interestWord: plan.kind === "loan" ? "interest" : "fees",
    };
  });
  const breakdown = breakdownText({
    person,
    open,
    today,
    myName: user.name,
    extra: theirPlans.map((p) => planLineText(p, today)),
    theirs,
  });
  const receipt = personReceipt({ person, open, plans: theirPlans, theirs, today, myName: user.name });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={person.name} size={52} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-display text-3xl font-semibold">{person.name}</h1>
          {person.contact && <span className="text-sm text-muted">{person.contact}</span>}
        </div>
        <EditPerson personId={person.id} name={person.name} contact={person.contact} />
      </div>

      <section className={`flex flex-col gap-1 rounded-[28px] p-6 ${late ? "bg-coral text-white" : "bg-sea text-white"}`}>
        <h2 className="text-sm font-bold uppercase opacity-90">
          {person.balance === 0 ? "All square" : owesYou ? `${person.name} owes you` : `You owe ${person.name}`}
        </h2>
        <span className="font-display text-4xl font-semibold">{formatPeso(Math.abs(person.balance))}</span>
        {owesYou && interestLeft > 0 && (
          <span className="text-[15px] opacity-90">
            + {formatPeso(interestLeft)} interest &amp; fees they pay the lender directly ·{" "}
            <strong>{formatPeso(roundCents(person.balance + interestLeft))} in all</strong>
          </span>
        )}
        {owesYou && theirs.next ? (
          <span className="text-[15px] font-bold opacity-90">
            {theirs.next.dueOn < today
              ? `Payment late · ${formatPeso(theirs.next.amount)} was due ${formatShortDay(theirs.next.dueOn, today)}`
              : `Next payment ${formatPeso(theirs.next.amount)} due ${formatShortDay(theirs.next.dueOn, today)}`}
          </span>
        ) : (
          due &&
          person.balance !== 0 && (
            <span className="text-[15px] font-bold opacity-90">
              {late ? `Overdue · was due ${formatShortDay(due, today)}` : `Due ${formatShortDay(due, today)}`}
            </span>
          )
        )}
      </section>

      {person.balance !== 0 && (
        <div className="grid grid-cols-1 gap-2">
          <PaymentForm personId={person.id} balance={person.balance} wallets={wallets} today={today} />
        </div>
      )}

      {person.balance !== 0 && open.length > 0 && (
        <ShareText
          text={breakdown}
          receipt={receipt}
          filename={`breakdown-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}
        />
      )}

      {onYourLines.length > 0 && (
        <section aria-labelledby="lines-heading" className="flex flex-col gap-2">
          <h2 id="lines-heading" className="font-display text-xl font-semibold">In your name</h2>
          <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
            {onYourLines.map(({ plan, next, unpaid, left, interest }) => (
              <li key={plan.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/money/${plan.accountId}`} className="truncate font-bold text-ink">
                    {plan.kind === "loan" ? `${names.get(plan.accountId) ?? "Loan"} loan` : `${plan.name} · ${names.get(plan.accountId) ?? "Credit line"}`}
                  </Link>
                  <span className={`text-[13px] ${next!.dueOn < today ? "font-bold text-coral-text" : "text-muted"}`}>
                    {formatPeso(next!.amount)} {dueText(next!.dueOn, today).toLowerCase()}
                    {plan.months > 1 && ` · ${next!.seq} of ${plan.months}`} · {formatPeso(left)} left
                    {interest > 0 && ` (incl. ${formatPeso(interest)} ${plan.kind === "loan" ? "interest" : "fees"})`}
                  </span>
                </span>
                <TheyPaidButton ids={[next!.id]} label={unpaid.length > 1 ? `Paid ${next!.seq} of ${plan.months}` : "They paid"} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Their payments, interest included, go straight to the lender, so your wallets and forecast don&apos;t
            change and none of it is your expense.
          </p>
        </section>
      )}

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h2 id="history-heading" className="font-display text-xl font-semibold">History</h2>
        <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
          {history.map((t) => {
            const entry = person.entries.find((e) => e.transactionId === t.id);
            const change = balanceEffect(t, person.id);
            const wallet = t.accountId === person.id ? t.toAccountId : t.accountId;
            const title =
              entry?.kind === "split" ? `Split: ${(t.note ?? "bill").replace(/^Split: /, "").replace(/ \(my share\)$/, "")}` : entry ? KIND_LABELS[entry.kind] : (t.note ?? "Transaction");
            const detail = [
              formatShortDay(t.occurredOn, today),
              wallet && `${change > 0 ? "from" : "into"} ${names.get(wallet) ?? "a wallet"}`,
              entry?.splitTotal && `share of ${formatPeso(entry.splitTotal)}`,
              entry?.kind !== "split" && t.note && !["Pautang", "Utang", "Paid back", "Paid me back", "Forgiven"].includes(t.note) && t.note,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={t.id} className="border-b border-line-soft last:border-0">
                <Link href={`/activity/${t.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2.5 text-ink">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-bold">{title}</span>
                    <span className="truncate text-[13px] text-muted">{detail}</span>
                  </span>
                  <span className="font-display text-[17px] font-semibold">
                    {change >= 0 ? "+" : "−"}
                    {formatPeso(Math.abs(change))}
                  </span>
                </Link>
              </li>
            );
          })}
          {!history.length && <li className="py-3 text-[15px] text-muted">Nothing yet.</li>}
        </ul>
        <p className="text-xs text-muted">+ means they owe you more, − means less (or you owe them).</p>
      </section>

      {person.balance !== 0 && <ForgiveButton personId={person.id} balance={person.balance} />}
    </>
  );
}

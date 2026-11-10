import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronIcon, PathIcon } from "@/components/icons";
import { Pong } from "@/components/pong";
import { ShareText } from "@/components/share-text";
import { getCurrentUser } from "@/lib/auth";
import { categoryInfo } from "@/lib/categories";
import { getAccounts, getInstallmentPlans, getPeople, getSplit, getTransactions } from "@/lib/data";
import { formatRelativeDay, formatShortDay, today as getToday, transactionTime } from "@/lib/dates";
import { dueText } from "@/lib/installments";
import { formatPeso, roundCents } from "@/lib/money";
import { billReceipt } from "@/lib/receipt";
import { billBreakdownText, toSplitBill, typedNote, unpaidByRecord } from "@/lib/splits";
import { AddToBill } from "./add-to-bill";
import { DeleteSplit } from "./delete-split";
import { EditSplit } from "./edit-split";

export const metadata = { title: "Split bill · Pong Money" };

// A split bill from Activity or Utang & pautang: the whole bill, each share
// and what's still unpaid. "Edit split" changes the whole bill, and can add people to it.
export default function SplitPage({ params, searchParams }: PageProps<"/activity/split/[id]">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl">
      <Suspense fallback={<div className="h-[560px] rounded-[20px] bg-line-soft" />}>
        <SplitDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SplitDetail({ params, searchParams }: PageProps<"/activity/split/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [records, accounts, people, recent, user] = await Promise.all([
    getSplit(id),
    getAccounts({ includeArchived: true, includePeople: true }),
    getPeople({ includeArchived: true }),
    getTransactions({ limit: 200 }),
    getCurrentUser(),
  ]);
  if (!records.length) notFound();
  const unpaid = unpaidByRecord(people, recent);

  const today = getToday();
  const split = toSplitBill(id, records);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  // Only people still in your list can be picked to add (a typed name brings an archived one back).
  const archivedIds = new Set(accounts.filter((a) => a.archived).map((a) => a.id));
  const info = categoryInfo("expense", split.mine?.category ?? "family");
  const wallet = names.get(split.accountId) ?? "Removed wallet";
  // Paid with a credit line: the whole bill is on its bill, as a payment plan.
  const credit = accounts.find((a) => a.id === split.accountId)?.type === "credit_line";
  const recordIds = new Set(records.map((r) => r.id));
  const plan = credit
    ? (await getInstallmentPlans(split.accountId)).find((p) => p.sourceTxnId && recordIds.has(p.sourceTxnId))
    : undefined;
  const nextPayment = plan?.payments.find((p) => !p.transactionId);
  const pautang = roundCents(split.total - (split.mine?.amount ?? 0));
  const fromPeople = query.from === "people";
  const back = fromPeople ? "/money/people?view=bills" : `/activity?p=${split.occurredOn}`;
  const stillOwed = roundCents(split.others.reduce((s, t) => s + (unpaid.get(t.id) ?? 0), 0));

  const rows = [
    ...(split.mine ? [{ id: split.mine.id, personId: null, name: "You", amount: split.mine.amount, what: `${info.label} · spending` }] : []),
    ...split.others.map((t) => {
      const left = unpaid.get(t.id) ?? 0;
      return {
        id: t.id,
        personId: t.toAccountId,
        name: names.get(t.toAccountId ?? "") ?? "Removed person",
        amount: t.amount,
        what: left === 0 ? "✓ Paid back" : left < t.amount ? `Still owes ${formatPeso(left)}` : "Pautang · not paid yet",
      };
    }),
  ];

  return (
    <>
      <Link href={back} className="flex h-10 w-fit items-center gap-1 font-extrabold text-sea-dark">
        <ChevronIcon direction="left" size={18} /> {fromPeople ? "Utang & pautang" : "Activity"}
      </Link>

      <section className="flex flex-col items-center gap-1 rounded-[28px] bg-card px-6 py-6 text-center">
        <span className={`mb-1 flex h-12 w-12 items-center justify-center rounded-2xl ${info.tint}`}>
          <PathIcon d={info.icon} size={24} />
        </span>
        <h1 className="font-display text-2xl font-semibold">{split.title}</h1>
        <span className="font-display text-[44px] leading-[1.1] font-semibold">{formatPeso(split.total)}</span>
        <span className="text-sm font-bold text-muted">
          {info.label} · {wallet} · {formatRelativeDay(split.occurredOn, today)}
          {transactionTime(split) && `, ${transactionTime(split)}`}
        </span>
      </section>

      <div className="flex min-h-14 items-center gap-2 rounded-[18px] bg-card py-1 pr-3 pl-1">
        <Pong mood={stillOwed === 0 ? "proud" : "happy"} size={52} decorative />
        <p className="text-sm leading-snug lg:text-[15px]">
          Your share is {formatPeso(split.mine?.amount ?? 0)}.{" "}
          {stillOwed === 0
            ? `Everyone has paid back the other ${formatPeso(pautang)}.`
            : stillOwed < pautang
              ? `${formatPeso(stillOwed)} of the ${formatPeso(pautang)} pautang is still unpaid.`
              : `${formatPeso(pautang)} is pautang, still your money.`}
        </p>
      </div>

      <section aria-labelledby="breakdown-label" className="rounded-[20px] bg-card px-4 py-3">
        <h2 id="breakdown-label" className="pb-1 text-[13px] font-extrabold text-muted">
          BREAKDOWN · {rows.length} {rows.length === 1 ? "SHARE" : "SHARES"}
        </h2>
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/activity/${r.id}`} className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-mint">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-bold">{r.name}</span>
                  <span className="truncate text-[13px] text-muted">{r.what}</span>
                </span>
                <span className="shrink-0 font-display text-[17px] font-semibold">{formatPeso(r.amount)}</span>
                <ChevronIcon size={18} className="shrink-0 text-muted" />
                <span className="sr-only">, edit</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-center justify-between border-t border-line-soft pt-2.5 pr-[26px]">
          <span className="font-extrabold">Total paid with {wallet}</span>
          <span className="font-display text-[17px] font-semibold">{formatPeso(split.total)}</span>
        </div>
      </section>

      {split.others.length > 0 && (
        <ShareText
          filename={`split-${split.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${split.occurredOn}.png`}
          text={billBreakdownText({ split, names, unpaid, dateLabel: formatShortDay(split.occurredOn, today), myName: user.name })}
          receipt={billReceipt({ split, names, unpaid, dateLabel: formatShortDay(split.occurredOn, today), wallet, myName: user.name })}
        />
      )}

      {credit && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-card px-4 py-3.5">
          {plan ? (
            <>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-bold text-muted">
                  On your {wallet} bill
                  {nextPayment
                    ? ` · ${formatShortDay(nextPayment.dueOn, today)} · ${dueText(nextPayment.dueOn, today)}`
                    : " · paid"}
                </span>
                <span className="font-display text-xl font-semibold">
                  {formatPeso(nextPayment?.amount ?? plan.principal)}
                  {plan.months > 1 && <span className="text-sm text-muted"> · {plan.months} months</span>}
                </span>
              </span>
              <Link
                href={`/money/${split.accountId}`}
                className="flex h-11 items-center rounded-[14px] bg-mint px-4 text-sm font-extrabold text-sea-dark"
              >
                See {wallet}
              </Link>
            </>
          ) : (
            <AddToBill splitId={id} wallet={wallet} total={split.total} />
          )}
        </section>
      )}

      <EditSplit
        key={`${split.occurredOn}|${rows.map((r) => `${r.id}:${r.amount}`).join(",")}`}
        splitId={id}
        note={typedNote(records)}
        date={split.occurredOn}
        shares={rows.map((r) => ({ id: r.id, personId: r.personId, name: r.name, amount: r.amount }))}
        people={people.filter((p) => !archivedIds.has(p.id)).map((p) => ({ id: p.id, name: p.name }))}
      />

      <p className="text-xs text-muted">
        Payments from each person are recorded on their page in Money › Utang &amp; pautang.
      </p>

      <DeleteSplit splitId={id} back={back} />
    </>
  );
}

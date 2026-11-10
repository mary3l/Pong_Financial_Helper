import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronIcon, PathIcon } from "@/components/icons";
import { Pong } from "@/components/pong";
import { getAccounts, getInstallmentPlans, getPeople, getTransactions, hasSplitIds } from "@/lib/data";
import { daysBetween, formatShortDay, today as getToday } from "@/lib/dates";
import { categoryInfo } from "@/lib/categories";
import { formatPeso, roundCents } from "@/lib/money";
import { dueDate, inYourName, isLate, type Person } from "@/lib/people";
import { groupSplits, unpaidByRecord, type SplitBill } from "@/lib/splits";
import { MoneyTabs } from "../money-tabs";
import { Avatar } from "./avatar";
import { RestorePerson, SettleButton } from "./person-actions";

export const metadata = { title: "Utang & pautang · Pong Money" };

// Design canvas 5.1: who owes you (oldest first) and who you owe. "By bill"
// lists split bills instead, each opening its breakdown.
export default function PeoplePage({ searchParams }: PageProps<"/money/people">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Money</h1>
      <MoneyTabs current="people" />
      <Suspense fallback={<div className="h-80 rounded-[20px] bg-line-soft" />}>
        <People searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function People({ searchParams }: Pick<PageProps<"/money/people">, "searchParams">) {
  await connection();
  const byBill = (await searchParams).view === "bills";
  const today = getToday();
  const [people, accounts, recent, splitsReady, plans] = await Promise.all([
    getPeople(),
    getAccounts({ includePeople: true, includeArchived: true }),
    getTransactions({ limit: 200 }),
    byBill ? hasSplitIds() : true,
    getInstallmentPlans(),
  ]);
  // Loans and purchases in your name that they pay (Tita Flora's MariLoan): the interest on top, and the next payment.
  const theirs = new Map(people.map((p) => [p.id, inYourName(p.id, plans)]));
  const of = (p: Person) => theirs.get(p.id)!;
  const oweYou = people.filter((p) => p.balance > 0);
  const youOwe = people.filter((p) => p.balance < 0);
  const interestTotal = roundCents(oweYou.reduce((sum, p) => sum + of(p).interest, 0));
  const owedTotal = roundCents(oweYou.reduce((sum, p) => sum + p.balance, 0) + interestTotal);
  const oweTotal = roundCents(youOwe.reduce((sum, p) => sum - p.balance, 0));
  const overdue = oweYou.filter((p) => isLate(p, of(p), today)).length;

  // The latest note for each person, e.g. "Split Grab ride · Nov 7".
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const lastNote = (p: Person) => {
    const t = recent.find((x) => x.accountId === p.id || x.toAccountId === p.id);
    return t ? `${t.note ?? "Utang"} · ${formatShortDay(t.occurredOn, today)}` : null;
  };
  // Archived (Delete with history): hidden from the lists above, back with Restore.
  const archivedPeople = accounts.filter((a) => a.type === "person" && a.archived);
  const sinceOldest = (p: Person) => of(p).next?.dueOn ?? dueDate(p) ?? "9999-12-31";

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-2xl bg-card px-4 py-3">
          <span className="text-xs font-bold text-muted">Owed to you</span>
          <span className="font-display text-2xl font-semibold">{formatPeso(owedTotal)}</span>
          <span className="text-xs text-muted">
            {oweYou.length} {oweYou.length === 1 ? "person" : "people"}
            {interestTotal > 0 && ` · incl. ${formatPeso(interestTotal)} interest`}
            {overdue > 0 && <strong className="text-coral-text"> · {overdue} overdue</strong>}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-2xl bg-card px-4 py-3">
          <span className="text-xs font-bold text-muted">You owe</span>
          <span className="font-display text-2xl font-semibold">{formatPeso(oweTotal)}</span>
          <span className="text-xs text-muted">{youOwe.length} {youOwe.length === 1 ? "person" : "people"}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link href="/money/people/new" className="flex h-12 items-center justify-center rounded-[18px] bg-sun font-extrabold text-ink">
          + Lend / borrow
        </Link>
        <Link href="/add?split=1" className="flex h-12 items-center justify-center rounded-[18px] border-2 border-sea font-extrabold text-sea-dark">
          + Split a bill
        </Link>
      </div>

      {people.length > 0 && (
        <nav aria-label="View" className="grid grid-cols-2 gap-1 rounded-xl bg-card p-1">
          {[
            { label: "By person", href: "/money/people", on: !byBill },
            { label: "By bill", href: "/money/people?view=bills", on: byBill },
          ].map((v) => (
            <Link
              key={v.label}
              href={v.href}
              aria-current={v.on ? "page" : undefined}
              className={`flex h-9 items-center justify-center rounded-lg text-sm ${
                v.on ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"
              }`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      )}

      {people.length > 0 && byBill ? (
        splitsReady ? (
          <Bills people={people} recent={recent} names={names} today={today} />
        ) : (
          <p className="rounded-[20px] bg-card px-4 py-3 text-[15px] text-muted">
            To see split bills here, run <strong className="text-ink">Step 12</strong> in supabase/SQL_GUIDE.md
            (migrations/0012_split_groups.sql) in your Supabase project, then reload.
          </p>
        )
      ) : people.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
          <Pong mood="listen" size={100} decorative />
          <p className="max-w-xs text-[15px] text-muted">
            Lent someone money, or split dinner? I&apos;ll keep track of who owes whom, and I
            won&apos;t count pautang as yours to spend until it&apos;s paid back.
          </p>
        </div>
      ) : (
        <>
          <section aria-labelledby="owe-you-heading" className="flex flex-col gap-2">
            <h2 id="owe-you-heading" className="text-[13px] font-extrabold text-muted">OWE YOU · OLDEST FIRST</h2>
            <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
              {[...oweYou].sort((a, b) => sinceOldest(a).localeCompare(sinceOldest(b))).map((p) => {
                const due = dueDate(p);
                const { interest, next } = of(p);
                const late = isLate(p, of(p), today);
                return (
                  <li key={p.id} className="border-b border-line-soft last:border-0">
                    <Link href={`/money/people/${p.id}`} className="flex min-h-14 items-center gap-2.5 py-2.5 text-ink sm:gap-3">
                      <Avatar name={p.name} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-bold">{p.name}</span>
                        <span className={`truncate text-[13px] ${late ? "font-bold text-coral-text" : "text-muted"}`}>
                          {next
                            ? `${next.dueOn < today ? "Late · was due" : "Next"} ${formatPeso(next.amount)}${next.dueOn < today ? "" : " due"} ${formatShortDay(next.dueOn, today)}`
                            : late
                              ? `Overdue ${daysBetween(due!, today)} ${daysBetween(due!, today) === 1 ? "day" : "days"}`
                              : due
                                ? `Expected ${formatShortDay(due, today)}`
                                : lastNote(p)}
                        </span>
                      </span>
                      {/* The amount wraps before the name gets squeezed out. */}
                      <span className="flex max-w-[48%] min-w-0 flex-col items-end text-right">
                        <span className="font-display text-[17px] font-semibold whitespace-nowrap">{formatPeso(roundCents(p.balance + interest))}</span>
                        {interest > 0 && (
                          <span className="text-xs leading-tight text-muted">
                            {formatPeso(p.balance)} + {formatPeso(interest)} interest
                          </span>
                        )}
                      </span>
                      <ChevronIcon size={20} className="hidden shrink-0 text-muted sm:block" />
                    </Link>
                  </li>
                );
              })}
              {!oweYou.length && <li className="py-3 text-[15px] text-muted">Nobody owes you right now.</li>}
            </ul>
          </section>

          <section aria-labelledby="you-owe-heading" className="flex flex-col gap-2">
            <h2 id="you-owe-heading" className="text-[13px] font-extrabold text-muted">YOU OWE</h2>
            <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
              {youOwe.map((p) => (
                <li key={p.id} className="flex min-h-14 items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
                  <Link href={`/money/people/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-ink">
                    <Avatar name={p.name} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-bold">{p.name}</span>
                      <span className="truncate text-[13px] text-muted">
                        {dueDate(p) ? `Due ${formatShortDay(dueDate(p)!, today)}` : lastNote(p)}
                      </span>
                    </span>
                  </Link>
                  <SettleButton personId={p.id} label={`Pay ${formatPeso(-p.balance)}`} />
                </li>
              ))}
              {!youOwe.length && <li className="py-3 text-[15px] text-muted">You don&apos;t owe anyone. Nice!</li>}
            </ul>
          </section>

          {people.some((p) => p.balance === 0) && (
            <p className="text-sm text-muted">
              <strong className="text-ink">All square:</strong>{" "}
              {people.filter((p) => p.balance === 0).map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link href={`/money/people/${p.id}`} className="font-bold text-sea-dark underline">{names.get(p.id)}</Link>
                </span>
              ))}
            </p>
          )}

          {archivedPeople.length > 0 && (
            <section aria-labelledby="archived-people-heading" className="flex flex-col gap-2">
              <h2 id="archived-people-heading" className="text-[13px] font-extrabold text-muted">ARCHIVED</h2>
              <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
                {archivedPeople.map((a) => (
                  <li key={a.id} className="flex min-h-14 items-center gap-3 border-b border-line-soft py-2 last:border-0">
                    <Link href={`/money/people/${a.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-muted">
                      <Avatar name={a.name} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-bold">{a.name}</span>
                        {a.balance !== 0 && (
                          <span className="text-[13px]">
                            {a.balance > 0 ? "Owed you" : "You owed"} {formatPeso(Math.abs(a.balance))}
                          </span>
                        )}
                      </span>
                    </Link>
                    <RestorePerson personId={a.id} />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Archived people keep their history. Restore brings them back to your lists.</p>
            </section>
          )}
        </>
      )}
      <p className="text-xs text-muted">
        Lending moves money out of your wallet but isn&apos;t spending: it&apos;s still yours. Safe to
        spend and the forecast never count pautang until it&apos;s paid back.
      </p>
    </>
  );
}

/** Split bills you paid, newest first: what's still owed on each, then the paid-back ones. */
function Bills({
  people,
  recent,
  names,
  today,
}: {
  people: Person[];
  recent: Awaited<ReturnType<typeof getTransactions>>;
  names: Map<string, string>;
  today: string;
}) {
  const unpaid = unpaidByRecord(people, recent);
  const bills = groupSplits(recent).flatMap((item) => {
    if (item.kind !== "split") return [];
    const owed = roundCents(item.split.others.reduce((s, t) => s + (unpaid.get(t.id) ?? 0), 0));
    const stillOwe = item.split.others.filter((t) => (unpaid.get(t.id) ?? 0) > 0).length;
    return [{ split: item.split, owed, stillOwe }];
  });
  const open = bills.filter((b) => b.owed > 0);
  const done = bills.filter((b) => b.owed === 0).slice(0, 10);

  const list = (rows: typeof bills) => (
    <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
      {rows.map((b) => (
        <li key={b.split.splitId} className="border-b border-line-soft last:border-0">
          <BillRow {...b} wallet={names.get(b.split.accountId) ?? "Removed wallet"} today={today} />
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <section aria-labelledby="bills-open-heading" className="flex flex-col gap-2">
        <h2 id="bills-open-heading" className="text-[13px] font-extrabold text-muted">STILL OWED · NEWEST FIRST</h2>
        {open.length ? (
          list(open)
        ) : (
          <p className="rounded-[20px] bg-card px-4 py-3 text-[15px] text-muted">
            {bills.length ? "Everyone has paid back their share. Nice!" : "No split bills yet. Tap + Split a bill when you pay for a group."}
          </p>
        )}
      </section>
      {done.length > 0 && (
        <section aria-labelledby="bills-done-heading" className="flex flex-col gap-2">
          <h2 id="bills-done-heading" className="text-[13px] font-extrabold text-muted">PAID BACK</h2>
          {list(done)}
        </section>
      )}
      <p className="text-xs text-muted">
        Payments are recorded per person, so I count each one against their oldest pautang first.
      </p>
    </>
  );
}

function BillRow({
  split,
  owed,
  stillOwe,
  wallet,
  today,
}: {
  split: SplitBill;
  owed: number;
  stillOwe: number;
  wallet: string;
  today: string;
}) {
  const info = categoryInfo("expense", split.mine?.category ?? "family");
  const people = split.others.length;
  return (
    <Link href={`/activity/split/${split.splitId}?from=people`} className="flex min-h-14 items-center gap-3 py-2.5 text-ink">
      <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] ${info.tint}`}>
        <PathIcon d={info.icon} size={21} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{split.title}</span>
        <span className="truncate text-[13px] text-muted">
          {formatShortDay(split.occurredOn, today)} · {wallet} ·{" "}
          {owed > 0 ? `${stillOwe} of ${people} still owe` : `${people} ${people === 1 ? "person" : "people"}, all paid`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="font-display text-[17px] font-semibold">{formatPeso(owed > 0 ? owed : split.total)}</span>
        <span className="text-xs text-muted">{owed > 0 ? `of ${formatPeso(split.total)}` : "bill total"}</span>
      </span>
      <ChevronIcon size={20} className="shrink-0 text-muted" />
    </Link>
  );
}

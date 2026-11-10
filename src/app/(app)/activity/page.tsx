import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronIcon } from "@/components/icons";
import { Pong } from "@/components/pong";
import { ListPages, TransactionList } from "@/components/transaction-list";
import { getAccounts, getTransactions, withoutArchived } from "@/lib/data";
import {
  formatPeriod,
  isValidDate,
  nextPeriod,
  periodContaining,
  previousPeriod,
  today as getToday,
} from "@/lib/dates";
import { cashflow, formatPeso, inPesos } from "@/lib/money";
import { groupSplits, pageOfItems, readPage } from "@/lib/splits";

export const metadata = { title: "Activity · Pong Money" };

// Design canvas 2.3: everything logged, one kinsenas at a time, in pages of
// about 30 rows (?page=, days kept whole where they fit). In, Out and Net are
// always for the whole kinsenas.
export default function ActivityPage({ searchParams }: PageProps<"/activity">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Activity</h1>
      <Suspense fallback={<ActivitySkeleton />}>
        <Activity searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Activity({ searchParams }: Pick<PageProps<"/activity">, "searchParams">) {
  const params = await searchParams;
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const p = typeof params.p === "string" && isValidDate(params.p) ? params.p : today;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 60) : "";
  const period = periodContaining(p);
  const isCurrent = period.start === periodContaining(today).start;

  const [accounts, transactions] = await Promise.all([
    getAccounts({ includeArchived: true, includePeople: true }),
    getTransactions({ from: period.start, to: period.end, search: q }).then(withoutArchived),
  ]);
  // Interest on a dollar wallet counts in pesos.
  const totals = cashflow(inPesos(transactions, accounts));
  const shown = pageOfItems(groupSplits(transactions), readPage(params.page));

  // Another kinsenas starts on its first page.
  const href = (start: string, page = 1) => {
    const query = new URLSearchParams({ p: start });
    if (q) query.set("q", q);
    if (page > 1) query.set("page", String(page));
    return `/activity?${query}`;
  };
  const next = nextPeriod(period);

  return (
    <>
      <nav aria-label="Kinsenas" className="flex items-center justify-between rounded-[20px] bg-card px-2 py-2">
        <Link
          href={href(previousPeriod(period).start)}
          aria-label="Previous kinsenas"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-mint"
        >
          <ChevronIcon direction="left" size={22} />
        </Link>
        <div className="flex flex-col items-center">
          <span className="font-display text-lg font-semibold">{formatPeriod(period, today)}</span>
          <span className="text-xs font-bold text-muted">{isCurrent ? "This kinsenas" : "Kinsenas"}</span>
        </div>
        {next.start <= today ? (
          <Link
            href={href(next.start)}
            aria-label="Next kinsenas"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-mint"
          >
            <ChevronIcon size={22} />
          </Link>
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        )}
      </nav>

      <dl className="grid grid-cols-3 gap-2">
        {[
          { label: "In", value: formatPeso(totals.in) },
          { label: "Out", value: formatPeso(totals.out) },
          { label: "Net", value: formatPeso(totals.net) },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-0.5 rounded-2xl bg-card px-3 py-2.5">
            <dt className="text-xs font-bold text-muted">{s.label}</dt>
            <dd className="font-display text-[17px] font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-2 text-xs text-muted">Transfers between your wallets aren&apos;t counted as in or out.</p>

      <Form action="/activity" className="flex gap-2" role="search">
        <input type="hidden" name="p" value={period.start} />
        <label htmlFor="activity-search" className="sr-only">Search notes and categories</label>
        <input
          id="activity-search"
          name="q"
          defaultValue={q}
          placeholder="Search notes, categories"
          className="h-12 min-w-0 flex-1 rounded-[14px] border-2 border-line bg-card px-4 text-base outline-none focus:border-sea"
        />
        <button type="submit" className="h-12 rounded-[14px] bg-card px-4 font-extrabold text-ink hover:bg-sea-tint">
          Search
        </button>
      </Form>

      {transactions.length ? (
        <>
          <div className="rounded-[20px] bg-card px-4 pb-2">
            <TransactionList transactions={transactions} items={shown.items} accounts={accounts} today={today} />
          </div>
          <ListPages page={shown.page} pages={shown.pages} href={(page) => href(period.start, page)} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
          <Pong mood="sleepy" size={100} decorative />
          <p className="max-w-xs text-[15px] text-muted">
            {q
              ? `Nothing matches "${q}" in this kinsenas.`
              : isCurrent
                ? "Nothing logged yet this kinsenas. Tap + to add an expense."
                : "Nothing logged in this kinsenas."}
          </p>
          {q && (
            <Link href={`/activity?p=${period.start}`} className="font-extrabold text-sea-dark underline">
              Clear search
            </Link>
          )}
        </div>
      )}
    </>
  );
}

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-16 rounded-[20px] bg-line-soft" />
      <div className="h-16 rounded-2xl bg-line-soft" />
      <div className="h-72 rounded-[20px] bg-line-soft" />
    </div>
  );
}

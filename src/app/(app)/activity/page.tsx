import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PeriodNav } from "@/components/period-nav";
import { Pong } from "@/components/pong";
import { ListPages, TransactionList } from "@/components/transaction-list";
import { categoryInfo, cleanSubcategory, subcategoryOptions } from "@/lib/categories";
import {
  getAccounts,
  getBillTags,
  getTransactions,
  getUserCategories,
  withoutArchived,
} from "@/lib/data";
import { isValidDate, today as getToday } from "@/lib/dates";
import { cashflow, formatPeso, inPesos } from "@/lib/money";
import { groupSplits, pageOfItems, readPage } from "@/lib/splits";
import { periodOf, readSpan, type Span } from "@/lib/trend";
import { ActivityFilters, type CategoryOption } from "./activity-filters";

export const metadata = { title: "Activity · Pong Money" };

// Design canvas 2.3: everything logged, one kinsenas (or with ?span=month, one
// month) at a time, in pages of about 30 rows (?page=, days kept whole where
// they fit). ?c= and ?sub= show one category and subcategory. In, Out and Net
// are for the whole period, of what's shown.
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
  const span = readSpan(params.span);
  const c = typeof params.c === "string" ? params.c.slice(0, 60) : "";
  const sub = c && typeof params.sub === "string" ? (cleanSubcategory(params.sub) ?? "") : "";
  const period = periodOf(span, p);
  const isCurrent = period.start === periodOf(span, today).start;
  const unit = span === "month" ? "month" : "kinsenas";

  const [accounts, all, custom] = await Promise.all([
    getAccounts({ includeArchived: true, includePeople: true }),
    getTransactions({ from: period.start, to: period.end, search: q }).then(withoutArchived),
    getUserCategories(),
  ]);

  // The categories logged this period, to pick from (and the picked one, even if gone).
  const seen = new Map<string, CategoryOption>();
  for (const t of all) {
    if (t.type === "transfer" || !t.category || seen.has(t.category)) continue;
    seen.set(t.category, {
      key: t.category,
      label: categoryInfo(t.type, t.category, custom).label,
      group: t.type === "income" ? "Income" : "Expense",
    });
  }
  const categories = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  const subcategories = c ? (subcategoryOptions(all)[c] ?? []) : [];
  if (sub && !subcategories.some((s) => s.toLowerCase() === sub.toLowerCase()))
    subcategories.unshift(sub);
  const transactions = all.filter(
    (t) =>
      (!c || (t.type !== "transfer" && t.category === c)) &&
      (!sub || cleanSubcategory(t.subcategory)?.toLowerCase() === sub.toLowerCase()),
  );
  const filtered = Boolean(c);
  const filterName = c
    ? `${seen.get(c)?.label ?? categoryInfo("expense", c, custom).label}${sub ? ` › ${sub}` : ""}`
    : "";

  // Interest on a dollar wallet counts in pesos.
  const totals = cashflow(inPesos(transactions, accounts));
  const shown = pageOfItems(groupSplits(transactions), readPage(params.page));
  const billTags = await getBillTags(
    shown.items.flatMap((i) => (i.kind === "one" ? [i.txn] : [])),
    accounts,
    today,
  );

  // What the URL keeps besides the period and page.
  const keep = (opts: { span?: Span; filter?: boolean } = {}) => {
    const query = new URLSearchParams();
    const s = opts.span ?? span;
    if (s === "month") query.set("span", "month");
    if (q) query.set("q", q);
    if (opts.filter !== false && c) {
      query.set("c", c);
      if (sub) query.set("sub", sub);
    }
    return query;
  };
  // Another period starts on its first page.
  const href = (start: string, page = 1, opts?: { span?: Span; filter?: boolean }) => {
    const query = keep(opts);
    query.set("p", start);
    if (page > 1) query.set("page", String(page));
    return `/activity?${query}`;
  };

  return (
    <>
      <PeriodNav
        span={span}
        period={period}
        today={today}
        href={(start, s) => href(start, 1, { span: s })}
      />

      <ActivityFilters
        categories={
          c && !seen.has(c)
            ? [...categories, { key: c, label: filterName.split(" › ")[0], group: "Expense" }]
            : categories
        }
        subcategories={subcategories}
        category={c}
        subcategory={sub}
        query={{ ...Object.fromEntries(keep({ filter: false })), p: period.start }}
      />

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
      <p className="-mt-2 text-xs text-muted">
        {filtered ? (
          <>
            Only {filterName}.{" "}
            <Link
              href={href(period.start, 1, { filter: false })}
              className="font-extrabold text-sea-dark underline"
            >
              Show all
            </Link>
          </>
        ) : (
          "Transfers between your wallets aren’t counted as in or out."
        )}{" "}
        <Link
          href={`/insights?${new URLSearchParams({ p: period.start, ...(span === "month" ? { span } : {}) })}`}
          className="font-extrabold text-sea-dark underline"
        >
          See trends
        </Link>
      </p>

      <Form action="/activity" className="flex gap-2" role="search">
        <input type="hidden" name="p" value={period.start} />
        {span === "month" && <input type="hidden" name="span" value="month" />}
        {c && <input type="hidden" name="c" value={c} />}
        {sub && <input type="hidden" name="sub" value={sub} />}
        <label htmlFor="activity-search" className="sr-only">
          Search notes and categories
        </label>
        <input
          id="activity-search"
          name="q"
          defaultValue={q}
          placeholder="Search notes, categories"
          className="h-12 min-w-0 flex-1 rounded-[14px] border-2 border-line bg-card px-4 text-base outline-none focus:border-sea"
        />
        <button
          type="submit"
          className="h-12 rounded-[14px] bg-card px-4 font-extrabold text-ink hover:bg-sea-tint"
        >
          Search
        </button>
      </Form>

      {transactions.length ? (
        <>
          <div className="rounded-[20px] bg-card px-4 pb-2">
            <TransactionList
              transactions={transactions}
              items={shown.items}
              accounts={accounts}
              today={today}
              billTags={billTags}
            />
          </div>
          <ListPages
            page={shown.page}
            pages={shown.pages}
            href={(page) => href(period.start, page)}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
          <Pong mood="sleepy" size={100} decorative />
          <p className="max-w-xs text-[15px] text-muted">
            {q
              ? `Nothing matches "${q}"${filtered ? ` in ${filterName}` : ""} this ${unit}.`
              : filtered
                ? `Nothing in ${filterName} this ${unit}.`
                : isCurrent
                  ? `Nothing logged yet this ${unit}. Tap + to add an expense.`
                  : `Nothing logged in this ${unit}.`}
          </p>
          {(q || filtered) && (
            <Link
              href={`/activity?${new URLSearchParams({ p: period.start, ...(span === "month" ? { span } : {}) })}`}
              className="font-extrabold text-sea-dark underline"
            >
              {q ? "Clear search" : "Show all"}
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

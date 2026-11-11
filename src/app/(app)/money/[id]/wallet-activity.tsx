import Link from "next/link";
import { WalletButtons } from "@/components/adjust-balance";
import { ChevronIcon } from "@/components/icons";
import { Pong } from "@/components/pong";
import { LogButton } from "@/components/log-button";
import { PaidInAdvanceTag } from "@/components/paid-in-advance-tag";
import { ListPages, TransactionList } from "@/components/transaction-list";
import { getAccounts, getScheduledFor, getTransactions, type Account } from "@/lib/data";
import { addDays, formatPeriod, nextPeriod, periodContaining, previousPeriod } from "@/lib/dates";
import { itemEffect, itemLabel, paidInAdvance, type ForecastItem } from "@/lib/forecast";
import { accountTypeLabel, formatMoney, formatPeso, fxGain, pesoValue, purposeLabel, roundCents, walletFlow } from "@/lib/money";
import { formatShortDay } from "@/lib/dates";
import { groupSplits, pageOfItems } from "@/lib/splits";

/**
 * A cash, bank or e-wallet account: what's in it, and everything that went in
 * and out of it, one kinsenas at a time. Transfers count here, since they move
 * this wallet's money even though they aren't spending. Long kinsenas come
 * in pages (?page=, like Activity) once the page passes `page`; In, Out and
 * Net are for the whole kinsenas.
 */
export async function WalletActivity({
  account,
  date,
  today,
  page,
}: {
  account: Account;
  date: string;
  today: string;
  /** From ?page= (readPage). Without it the whole kinsenas shows. */
  page?: number;
}) {
  const period = periodContaining(date);
  const isCurrent = period.start === periodContaining(today).start;
  const next = nextPeriod(period);

  // From the kinsenas' start on, so the balance can be worked back to what it was then.
  const [accounts, since, coming] = await Promise.all([
    getAccounts({ includeArchived: true, includePeople: true }),
    getTransactions({ from: period.start, accountId: account.id }),
    // Scheduled items are in pesos: a dollar wallet never has any.
    account.currency === "USD" || account.archived ? Promise.resolve([]) : getScheduledFor(account.id, today, COMING_DAYS),
  ]);
  const transactions = since.filter((t) => t.occurredOn <= period.end);
  const flow = walletFlow(transactions, account.id);
  const ended = roundCents(account.balance - walletFlow(since.filter((t) => t.occurredOn > period.end), account.id).net);
  const started = roundCents(ended - flow.net);
  const href = (start: string, n = 1) => `/money/${account.id}?p=${start}${n > 1 ? `&page=${n}` : ""}`;
  const items = groupSplits(transactions);
  const shown = page === undefined ? { items, page: 1, pages: 1 } : pageOfItems(items, page);
  // In the wallet's own currency: dollars for a USD time deposit.
  const money = (value: number) => formatMoney(value, account.currency);

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h1 className="font-display text-3xl font-semibold">{account.name}</h1>
        <span className="text-[15px] text-muted">
          {accountTypeLabel(account.type)} · {purposeLabel(account.purpose)}
          {account.currency === "USD" && " · US dollars"}
          {account.interestRate !== null && ` · ${account.interestRate}% a year`}
          {account.interestPayout === "maturity" &&
            account.maturesOn &&
            ` · ${account.maturesOn > today ? "matures" : "matured"} ${formatShortDay(account.maturesOn, today)}`}
          {account.archived && " · archived"}
        </span>
      </div>

      <section className="flex flex-col gap-1 rounded-[28px] bg-sea p-6 text-white">
        <h2 className="text-sm font-bold text-sea-text">IN IT NOW</h2>
        <span className="font-display text-4xl font-semibold">{money(account.balance)}</span>
        {account.currency === "USD" && (
          <>
            <span className="text-sm text-sea-text">
              ≈ {formatPeso(pesoValue(account))} at {formatPeso(account.fxRate ?? 0)} per $1
              {account.fxAsOf
                ? account.fxAsOf === today
                  ? " today"
                  : ` (as of ${formatShortDay(account.fxAsOf, today)})`
                : ", your rate (today's couldn't be fetched)"}
            </span>
            {account.fxAsOf && account.boughtAt && (
              <span className="text-sm font-bold">
                {fxGain(account) === 0
                  ? "No change"
                  : `${fxGain(account) > 0 ? "▲ +" : "▼ −"}${formatPeso(Math.abs(fxGain(account)))}`}{" "}
                <span className="font-semibold text-sea-text">from the {formatPeso(account.boughtAt)} per $1 you got</span>
              </span>
            )}
          </>
        )}
      </section>

      <WalletButtons account={account} today={today} />

      {coming.length > 0 && <ComingUp account={account} items={coming} accounts={accounts} today={today} />}

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
          { label: "In", value: flow.in },
          { label: "Out", value: flow.out },
          { label: "Net", value: flow.net },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-0.5 rounded-2xl bg-card px-3 py-2.5">
            <dt className="text-xs font-bold text-muted">{s.label}</dt>
            <dd className={`font-display text-[17px] font-semibold ${s.value < 0 ? "text-coral-text" : ""}`}>
              {money(s.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="-mt-2 text-xs text-muted">
        Started the kinsenas with {money(started)}, {isCurrent ? "now" : "ended with"} {money(ended)}.
        Transfers to and from your other wallets count here.
      </p>

      {transactions.length ? (
        <>
          <div className="rounded-[20px] bg-card px-4 pb-2">
            <TransactionList transactions={transactions} items={shown.items} accounts={accounts} today={today} walletId={account.id} />
          </div>
          <ListPages page={shown.page} pages={shown.pages} href={(n) => href(period.start, n)} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
          <Pong mood="sleepy" size={100} decorative />
          <p className="max-w-xs text-[15px] text-muted">
            {isCurrent
              ? `Nothing in or out of ${account.name} yet this kinsenas.`
              : `Nothing in or out of ${account.name} in this kinsenas.`}
          </p>
        </div>
      )}
    </>
  );
}

/** How far ahead Coming up looks. */
const COMING_DAYS = 30;

/**
 * Pay landing in this wallet and bills, planned expenses and installments
 * paid from it, with what's left in it after each. Only what's set to this
 * wallet (Plan › Scheduled › Paid from / Goes to): the rest is in Plan.
 */
function ComingUp({ account, items, accounts, today }: { account: Account; items: ForecastItem[]; accounts: Account[]; today: string }) {
  const weekOut = addDays(today, 7);
  // What's in it after each, in order.
  const rows = items.reduce<{ item: ForecastItem; after: number }[]>(
    (out, item) => [...out, { item, after: roundCents((out.at(-1)?.after ?? account.balance) + itemEffect(item)) }],
    [],
  );
  return (
    <section aria-labelledby="coming-heading" className="flex flex-col gap-2">
      <h2 id="coming-heading" className="font-display text-xl font-semibold">Coming up</h2>
      <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
        {rows.map(({ item, after }) => {
          const change = itemEffect(item);
          const late = item.dueOn < today;
          const soon = item.dueOn < weekOut;
          const payEarly = !soon && item.flow === "out" && item.amount !== null;
          return (
            <li key={item.key} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-line-soft py-2.5 last:border-0">
              <span className={`row-span-2 text-xs font-extrabold uppercase ${late ? "text-coral-text" : "text-muted"}`}>
                {late ? "Late" : formatShortDay(item.dueOn, today)}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="truncate font-bold">
                  {item.name}
                  {item.estimate && <span className="font-normal text-muted"> (est.)</span>}
                </span>
                {paidInAdvance(item) && <PaidInAdvanceTag paidOn={item.paidOn!} today={today} />}
              </span>
              <span className={`text-right font-display text-[17px] font-semibold ${change > 0 ? "text-sea" : ""}`}>
                {item.amount === null ? "amount not set" : `${item.flow === "in" ? "+" : "−"}${formatPeso(item.amount)}`}
              </span>
              <span className="text-[13px] text-muted">
                {itemLabel(item)} · {account.name} after{" "}
                <span className={after < 0 ? "font-bold text-coral-text" : ""}>{formatPeso(after)}</span>
              </span>
              <span className="flex justify-end">
                {(soon || payEarly || item.transactionId) && <LogButton item={item} accounts={accounts} early={payEarly} />}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        The next {COMING_DAYS} days of what&apos;s set to go in or out of {account.name}. Bills with no wallet set
        are in <Link href="/plan" className="font-extrabold text-sea-dark underline">Plan</Link>.
      </p>
    </section>
  );
}

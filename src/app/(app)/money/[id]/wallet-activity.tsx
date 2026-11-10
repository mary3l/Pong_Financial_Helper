import Link from "next/link";
import { WalletButtons } from "@/components/adjust-balance";
import { ChevronIcon } from "@/components/icons";
import { Pong } from "@/components/pong";
import { ListPages, TransactionList } from "@/components/transaction-list";
import { getAccounts, getTransactions, type Account } from "@/lib/data";
import { formatPeriod, nextPeriod, periodContaining, previousPeriod } from "@/lib/dates";
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
  const [accounts, since] = await Promise.all([
    getAccounts({ includeArchived: true, includePeople: true }),
    getTransactions({ from: period.start, accountId: account.id }),
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

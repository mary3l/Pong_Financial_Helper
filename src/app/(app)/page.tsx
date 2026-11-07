import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DisplayNameForm } from "@/components/display-name-form";
import { ForecastChart } from "@/components/forecast-chart";
import { LogButton } from "@/components/log-button";
import { Pong, type PongMood } from "@/components/pong";
import { ThemeToggle } from "@/components/theme";
import { TransactionList } from "@/components/transaction-list";
import { getCurrentUser } from "@/lib/auth";
import { DEBT_SHARE, SURPLUS_SHARE, creditRoom, totalUsable, type BnplCap, type CreditRoom } from "@/lib/bnpl";
import { categoryInfo } from "@/lib/categories";
import {
  getBnplCap,
  getBudgets,
  getPlanInputs,
  getScheduledTransactionIds,
  getTransactions,
  withoutArchived,
  type Account,
  type Budget,
  type Transaction,
} from "@/lib/data";
import {
  addDays,
  formatLongDay,
  formatRelativeDay,
  formatShortDay,
  periodContaining,
  today as getToday,
} from "@/lib/dates";
import { itemLabel, project, safeToSpend, type ForecastItem, type SafeToSpend } from "@/lib/forecast";
import { getUsdRate } from "@/lib/fx";
import {
  accountTypeLabel,
  countsAsSpending,
  formatBalance,
  formatMoney,
  formatPeso,
  fxGain,
  isDebt,
  isSpendable,
  pesoTotal,
  pesoValue,
  purposeLabel,
  roundCents,
} from "@/lib/money";
import { dueDate, isOverdue } from "@/lib/people";

// Design canvas 2.1: Safe to spend (with its breakdown), Coming up (bills and
// expenses with Mark paid, pay and income with Add income), the next 30 days,
// wallet balances and today's activity.
export default function HomePage() {
  return (
    <div className="flex flex-col gap-5">
      <Suspense fallback={<HeaderSkeleton />}>
        <Header />
      </Suspense>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

async function Header() {
  const user = await getCurrentUser();
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-muted">{formatLongDay(getToday())}</span>
          <h1 className="font-display text-2xl font-semibold lg:text-3xl">
            {user.name ? `Kumusta, ${user.name}!` : "Kumusta!"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Link
            href="/settings"
            aria-label="Settings and tools"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sun font-display text-lg font-semibold text-ink"
          >
            {user.name ? user.name.charAt(0).toUpperCase() : <PersonIcon />}
          </Link>
        </div>
      </div>

      {!user.name && (
        <section className="rounded-3xl bg-card p-5">
          <DisplayNameForm
            initialName={null}
            label="What should I call you?"
            hint="Pick any name or nickname. You can change it later in Settings."
          />
        </section>
      )}
    </>
  );
}

async function Dashboard() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const period = periodContaining(today);
  const [plan, todays, budgets, spentThisKinsenas] = await Promise.all([
    getPlanInputs(today, 30),
    getTransactions({ from: today, to: today }),
    getBudgets(),
    getTransactions({ from: period.start, to: period.end }),
  ]);
  const { accounts, inWallets, setAside, payday, items, people } = plan;
  const credit = creditRoom(accounts);
  const [activity, spentToday, cap] = await Promise.all([
    withoutArchived(todays),
    spendingToday(todays, accounts),
    credit.length ? getBnplCap(today, plan) : null,
  ]);
  const sts = safeToSpend({ inWallets, payday, items, today, spentToday });
  const forecast = project(inWallets, items, today, 30);
  const pong = pongSays(sts, accounts.length > 0, today);
  // Everything scheduled in the next 7 days, plus late planned items.
  const weekOut = addDays(today, 7);
  const dueSoon = items.filter((i) => i.dueOn < weekOut && (i.dueOn >= today || !i.transactionId));
  const hasScheduled = items.some((i) => i.kind !== "planned");
  const wallets = accounts.filter((a) => isSpendable(a.type));
  const dollars = wallets.filter((a) => a.currency === "USD");
  const overdue = people.filter((p) => isOverdue(p, today));
  const owed = roundCents(accounts.filter((a) => isDebt(a.type)).reduce((sum, a) => sum + Math.max(0, -a.balance), 0));

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-5">
        <div className="flex items-end gap-1">
          <Pong mood={pong.mood} size={92} decorative />
          <p className="relative mb-5 flex-1 rounded-[20px_20px_20px_6px] bg-card px-3.5 py-3 text-[15px] leading-relaxed shadow-[0_2px_0_var(--color-line)]">
            {pong.message}{" "}
            {pong.link && (
              <Link href={pong.link.href} className="font-extrabold text-sea-dark underline">
                {pong.link.label}
              </Link>
            )}
          </p>
        </div>

        <SafeToSpendCard sts={sts} setAside={setAside} credit={credit} cap={cap} today={today} />

        {overdue.length > 0 && (
          <section aria-label="Overdue pautang" className="flex flex-col gap-1 rounded-[20px] bg-coral-tint px-4 py-3">
            {overdue.map((p) => (
              <p key={p.id} className="text-[15px]">
                <strong>{p.name}</strong>&apos;s {formatPeso(p.balance)} was due{" "}
                {formatShortDay(dueDate(p)!, today)}.{" "}
                <Link href={`/money/people/${p.id}`} className="font-extrabold text-coral-text underline">
                  Remind {p.name}
                </Link>
              </p>
            ))}
          </section>
        )}

        <section aria-labelledby="due-heading" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <h2 id="due-heading" className="font-display text-xl font-semibold">Coming up</h2>
            <Link href="/plan/scheduled" className="text-sm font-extrabold text-sea">Scheduled ›</Link>
          </div>
          <div className="rounded-[20px] bg-card px-4 py-1.5">
            {dueSoon.length ? (
              <ul className="flex flex-col">
                {dueSoon.map((item) => (
                  <DueRow key={item.key} item={item} accounts={accounts} today={today} />
                ))}
              </ul>
            ) : (
              <p className="py-3 text-[15px] text-muted">
                {hasScheduled ? (
                  "Nothing coming in or going out in the next 7 days."
                ) : (
                  <>
                    Nothing scheduled yet.{" "}
                    <Link href="/plan/scheduled" className="font-extrabold text-sea-dark underline">
                      Add bills, payroll and other income
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="wallets-heading" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <h2 id="wallets-heading" className="font-display text-xl font-semibold">Wallets</h2>
            <Link href="/money" className="text-sm font-extrabold text-sea">Money ›</Link>
          </div>
          <div className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
            {wallets.length ? (
              wallets.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 border-b border-line-soft py-2.5 last:border-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-bold">{a.name}</span>
                    <span className="text-[13px] text-muted">
                      {accountTypeLabel(a.type)}
                      {a.purpose !== "spending" && ` · ${purposeLabel(a.purpose)}`}
                    </span>
                  </span>
                  <span className={`font-display text-[17px] font-semibold ${a.balance < 0 ? "text-coral-text" : ""}`}>
                    {formatBalance(a)}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-3 text-[15px] text-muted">
                No wallets yet. <Link href="/money" className="font-extrabold text-sea-dark underline">Add one</Link>
              </p>
            )}
            {owed > 0 && (
              <Link href="/money" className="flex items-center justify-between gap-3 py-2.5 text-ink">
                <span className="flex flex-col">
                  <span className="font-bold">You owe</span>
                  <span className="text-[13px] text-muted">BNPL and loans</span>
                </span>
                <span className="font-display text-[17px] font-semibold text-coral-text">{formatPeso(owed)}</span>
              </Link>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-5">
        {accounts.length > 0 && (
          <Link
            href="/plan"
            className="flex flex-col gap-2.5 rounded-[20px] bg-card px-4 py-3.5 text-ink hover:ring-2 hover:ring-sea-tint"
          >
            <span className="flex items-baseline justify-between">
              <span className="font-display text-xl font-semibold">Next 30 days</span>
              <span className="text-sm font-extrabold text-sea">Forecast ›</span>
            </span>
            <ForecastChart
              days={forecast.days}
              low={forecast.lowest}
              paydays={items.filter((i) => i.kind === "payday").map((i) => i.dueOn)}
              height={64}
              label={`Projected balance for the next 30 days. Lowest ${formatPeso(forecast.lowest.balance)} on ${formatShortDay(forecast.lowest.date, today)}.`}
            />
            <span className="text-[15px]">
              Lowest:{" "}
              <strong className={forecast.lowest.balance < 0 ? "text-coral-text" : ""}>
                {formatPeso(forecast.lowest.balance)} on {formatShortDay(forecast.lowest.date, today)}
              </strong>
              {sts.nextPayday && forecast.lowest.date === addDays(sts.nextPayday, -1) && ", the day before payday"}
            </span>
          </Link>
        )}

        <BudgetsCard budgets={budgets} spent={spentThisKinsenas} />

        <section aria-labelledby="today-heading" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <h2 id="today-heading" className="font-display text-xl font-semibold">Today</h2>
            <Link href="/activity" className="text-sm font-extrabold text-sea">See all ›</Link>
          </div>
          <div className="rounded-[20px] bg-card px-4 py-1.5">
            {activity.length ? (
              <TransactionList transactions={activity} accounts={accounts} today={today} grouped={false} />
            ) : (
              <p className="py-3 text-[15px] text-muted">
                Nothing logged today. Tap <strong className="text-ink">+</strong> to add an expense.
              </p>
            )}
          </div>
        </section>

        {dollars.length > 0 && <DollarsCard wallets={dollars} today={today} />}
      </div>
    </div>
  );
}

/**
 * What today's expenses took out of spending wallets. Bills, planned items
 * and installments you paid today don't count: Safe to spend already set
 * that money aside as "due before payday".
 */
async function spendingToday(todays: Transaction[], accounts: Account[]): Promise<number> {
  const spending = new Set(accounts.filter((a) => countsAsSpending(a)).map((a) => a.id));
  const expenses = todays.filter((t) => t.type === "expense" && spending.has(t.accountId));
  const scheduled = await getScheduledTransactionIds(expenses.map((t) => t.id));
  return roundCents(expenses.filter((t) => !scheduled.has(t.id)).reduce((sum, t) => sum + t.amount, 0));
}

/** Desktop dashboard: budgets this kinsenas at a glance (design "Web · Dashboard"). */
function BudgetsCard({ budgets, spent }: { budgets: Budget[]; spent: { type: string; category: string | null; amount: number }[] }) {
  if (!budgets.length) return null;
  const used = (category: string) =>
    roundCents(spent.filter((t) => t.type === "expense" && t.category === category).reduce((sum, t) => sum + t.amount, 0));
  return (
    <Link href="/plan/budgets" className="hidden flex-col gap-3 rounded-[20px] bg-card px-4 py-3.5 text-ink hover:ring-2 hover:ring-sea-tint lg:flex">
      <span className="flex items-baseline justify-between">
        <span className="font-display text-xl font-semibold">Budgets</span>
        <span className="text-sm font-extrabold text-sea">This kinsenas ›</span>
      </span>
      {budgets.slice(0, 5).map((b) => {
        const u = used(b.category);
        const over = u > b.amount;
        return (
          <span key={b.id} className="flex flex-col gap-1">
            <span className="flex justify-between text-sm">
              <span className="font-bold">{categoryInfo("expense", b.category).label}</span>
              <span className={over ? "font-bold text-coral-text" : "text-muted"}>
                {formatPeso(u)} of {formatPeso(b.amount)}
              </span>
            </span>
            <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-line-soft">
              <span className={`block h-full rounded-full ${over ? "bg-coral" : "bg-sea"}`} style={{ width: `${Math.min(100, (u / b.amount) * 100)}%` }} />
            </span>
          </span>
        );
      })}
    </Link>
  );
}

function DueRow({ item, accounts, today }: { item: ForecastItem; accounts: Account[]; today: string }) {
  const paid = Boolean(item.transactionId);
  const late = item.dueOn < today && !paid;
  const wallet = accounts.find((a) => a.id === item.accountId);
  const incoming = item.flow === "in";
  const meta = [
    itemLabel(item),
    late ? `Late, was ${formatShortDay(item.dueOn, today)}` : formatRelativeDay(item.dueOn, today),
    wallet && `${incoming ? "to" : "from"} ${wallet.name}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-bold ${paid ? "text-muted line-through" : ""}`}>{item.name}</span>
        <span className={`text-[13px] ${late ? "font-bold text-coral-text" : "text-muted"}`}>{meta}</span>
      </span>
      <span className={`font-display text-[17px] font-semibold ${paid ? "text-muted line-through" : incoming ? "text-sea" : ""}`}>
        {item.estimate && !paid && (
          <>
            <span aria-hidden="true">~</span>
            <span className="sr-only">about </span>
          </>
        )}
        {item.amount === null ? "₱?" : `${incoming ? "+" : ""}${formatPeso(item.amount)}`}
      </span>
      <LogButton item={item} accounts={accounts} />
    </li>
  );
}

/**
 * Your dollars (a GoTyme USD Time Deposit) at today's rate, and how many
 * pesos more (or less) that is than the rate you got for them.
 */
async function DollarsCard({ wallets, today }: { wallets: Account[]; today: string }) {
  const rate = await getUsdRate();
  const total = roundCents(wallets.reduce((sum, a) => sum + a.balance, 0));
  const worth = pesoTotal(wallets);
  const gain = roundCents(wallets.reduce((sum, a) => sum + fxGain(a), 0));
  const one = wallets.length === 1 ? wallets[0] : null;

  return (
    <section aria-labelledby="dollars-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 id="dollars-heading" className="font-display text-xl font-semibold">US dollars</h2>
        <Link href={one ? `/money/${one.id}` : "/money"} className="text-sm font-extrabold text-sea">
          {one ? `${one.name} ›` : "Money ›"}
        </Link>
      </div>
      <div className="flex flex-col gap-2 rounded-[20px] bg-card px-4 py-3.5">
        {rate ? (
          <p className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>
              US$1 = <strong className="font-display text-[22px] font-semibold">{formatPeso(rate.rate)}</strong>
            </span>
            <span className="text-xs text-muted">
              {rate.asOf === today ? "today's rate" : `rate as of ${formatShortDay(rate.asOf, today)}`} ·{" "}
              <a href={rate.source.url} target="_blank" rel="noopener noreferrer" className="underline">
                {rate.source.name}
              </a>
            </span>
          </p>
        ) : (
          <p className="text-[13px] text-muted">
            Couldn&apos;t get today&apos;s rate, so this uses the rate you set on your dollar wallet. It tries again in a few minutes.
          </p>
        )}
        <p className="text-[15px]">
          Your <strong>{formatMoney(total, "USD")}</strong> is worth ≈{" "}
          <strong className="font-display text-[17px] font-semibold">{formatPeso(worth)}</strong>
        </p>
        {rate && (
          <p className={`text-[15px] font-extrabold ${gain > 0 ? "text-sea-dark" : gain < 0 ? "text-coral-text" : "text-muted"}`}>
            {gain > 0 ? "▲ " : gain < 0 ? "▼ " : ""}
            {gain === 0 ? "No change" : `${gain > 0 ? "+" : "−"}${formatPeso(Math.abs(gain))}`}
            <span className="font-semibold text-muted">
              {one?.boughtAt
                ? ` from the ${formatPeso(one.boughtAt)} per $1 you got`
                : " from the rates you got"}
            </span>
          </p>
        )}
        {wallets.length > 1 && (
          <ul className="flex flex-col border-t border-line-soft pt-1.5 text-[13px]">
            {wallets.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-1">
                <span className="truncate">{a.name}</span>
                <span className="text-muted">
                  {formatBalance(a)} ≈ {formatPeso(pesoValue(a))}
                  {fxGain(a) !== 0 && ` (${fxGain(a) > 0 ? "+" : "−"}${formatPeso(Math.abs(fxGain(a)))})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SafeToSpendCard({
  sts,
  setAside,
  credit,
  cap,
  today,
}: {
  sts: SafeToSpend;
  setAside: number;
  /** BNPL lines: shown apart, never in the numbers above them. */
  credit: CreditRoom[];
  /** Pong's monthly BNPL cap; null without credit lines. */
  cap: BnplCap | null;
  today: string;
}) {
  const hasPayday = sts.perDay !== null && sts.nextPayday;
  // Something to show: a limit, or a cap (or a pause) that holds every line.
  const showCredit = cap !== null && (cap.left !== null || credit.some((l) => l.creditLeft !== null));
  return (
    <section className="relative flex flex-col gap-1.5 overflow-hidden rounded-[28px] bg-sea p-6 text-white lg:p-7">
      <div aria-hidden="true" className="absolute -top-12 -right-10 h-40 w-40 rounded-full bg-sea-light" />
      <h2 className="relative text-sm font-bold text-sea-text">
        {hasPayday ? "SAFE TO SPEND TODAY" : "IN YOUR WALLETS"}
      </h2>
      <p className="relative font-display text-5xl leading-none font-semibold lg:text-6xl">
        {formatPeso(hasPayday ? sts.leftToday! : sts.inWallets)}
      </p>
      {hasPayday && sts.spentToday > 0 && (
        <p className="relative text-[15px] font-extrabold">
          {sts.leftToday! < 0
            ? `Over by ${formatPeso(-sts.leftToday!)}: spent ${formatPeso(sts.spentToday)} of ${formatPeso(sts.perDay!)} today`
            : `Spent ${formatPeso(sts.spentToday)} of today's ${formatPeso(sts.perDay!)}`}
        </p>
      )}
      <p className="relative text-[15px] text-sea-text">
        {hasPayday
          ? `${formatPeso(sts.perDay!)} a day until payday on ${formatShortDay(sts.nextPayday!, today)} · ${sts.daysLeft} ${sts.daysLeft === 1 ? "day" : "days"} left`
          : "Set your payday to see a daily amount."}
      </p>
      {showCredit && <CreditAvailable lines={credit} cap={cap} />}
      {hasPayday && (
        <details className="group relative">
          <summary className="flex h-11 w-fit cursor-pointer list-none items-center text-[15px] font-extrabold text-white underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">How is this computed?</span>
            <span className="hidden group-open:inline">Hide breakdown</span>
          </summary>
          <dl className="flex flex-col gap-1.5 rounded-[18px] bg-sea-deep px-4 py-3.5 text-[15px]">
            <BreakdownLine
              label={sts.spentToday > 0 ? "Spending money in your wallets this morning" : "Spending money in your wallets"}
              value={formatPeso(roundCents(sts.inWallets + sts.spentToday))}
            />
            <BreakdownLine label={`− Due before payday (${sts.dueCount})`} value={formatPeso(sts.dueBeforePayday)} />
            <BreakdownLine
              label={`= Free until ${formatShortDay(sts.nextPayday!, today)}`}
              value={formatPeso(sts.free)}
              strong
              divider
            />
            <BreakdownLine
              label={`÷ ${sts.daysLeft} ${sts.daysLeft === 1 ? "day" : "days"}`}
              value={`${formatPeso(sts.perDay!)} / day`}
              strong
            />
            <BreakdownLine label="− Spent today" value={formatPeso(sts.spentToday)} />
            <BreakdownLine label="= Left for today" value={formatPeso(sts.leftToday!)} strong divider />
          </dl>
          <p className="pt-2 text-[13px] leading-snug text-sea-text">
            Only spending money in cash, bank and e-wallets counts
            {setAside > 0 && <> (your {formatPeso(setAside)} in savings, emergency fund and investments doesn&apos;t)</>}.
            Pautang, credit limits and loans never do,
            and neither does income you haven&apos;t received yet. A bill stops counting once
            you mark it paid. What you spend today comes out of today&apos;s share; paying a
            scheduled bill doesn&apos;t, since it was already set aside.
          </p>
          {cap && <CreditBreakdown lines={credit} cap={cap} />}
        </details>
      )}
    </section>
  );
}

/** Borrowed money you could still use: apart from, and quieter than, your own. */
function CreditAvailable({ lines, cap }: { lines: CreditRoom[]; cap: BnplCap }) {
  return (
    <div className="relative mt-1.5 flex flex-col gap-0.5 border-t border-dashed border-sea-light pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-bold text-sea-text">BNPL YOU CAN STILL USE</h3>
        <span className="font-display text-2xl font-semibold">{formatPeso(totalUsable(lines, cap.left))}</span>
      </div>
      <p className="text-[13px] leading-snug text-sea-text">
        {cap.status === "set" && (
          <>
            Borrowed · my cap this month {formatPeso(cap.cap!)}
            {cap.used > 0 && <>, {formatPeso(cap.used)} used</>}
          </>
        )}
        {cap.status === "paused" && <>Paused: {cap.reason}</>}
        {cap.status === "unknown" && <>Borrowed, you pay it back later. {cap.reason}</>}
      </p>
    </div>
  );
}

function CreditBreakdown({ lines, cap }: { lines: CreditRoom[]; cap: BnplCap }) {
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  return (
    <>
      <h3 className="pt-4 pb-1.5 text-[13px] font-extrabold text-sea-text">BNPL · NOT IN THE NUMBERS ABOVE</h3>
      {cap.months > 0 && cap.income > 0 && (
        <dl className="mb-2 flex flex-col gap-1.5 rounded-[18px] bg-sea-deep px-4 py-3.5 text-[15px]">
          <BreakdownLine
            label={
              cap.estimated
                ? "Take-home a month (your pay in the next 30 days)"
                : `Take-home a month (last ${cap.months} ${cap.months === 1 ? "month" : "months"})`
            }
            value={formatPeso(cap.income)}
          />
          <BreakdownLine
            label={cap.estimated ? "− Spending a month (bills + this month's daily rate)" : "− Spending a month"}
            value={formatPeso(cap.spending)}
          />
          <BreakdownLine label="= Left after spending" value={formatPeso(cap.surplus)} strong divider />
          <BreakdownLine
            label={`All BNPL and loan payments: the smaller of ${percent(DEBT_SHARE)} of take-home (${formatPeso(cap.byIncome)}) and ${percent(SURPLUS_SHARE)} of what's left (${formatPeso(cap.bySurplus)})`}
            value={formatPeso(cap.ceiling)}
            strong
            divider
          />
          <BreakdownLine label="− Installments and loans due in 30 days" value={formatPeso(cap.debtPayments)} />
          <BreakdownLine label="= My cap on new BNPL this month" value={formatPeso(cap.cap!)} strong divider />
          <BreakdownLine label="− Charged to BNPL this month" value={formatPeso(cap.used)} />
          <BreakdownLine label="= Left this month" value={formatPeso(cap.left!)} strong divider />
        </dl>
      )}
      <dl className="flex flex-col gap-2 rounded-[18px] bg-sea-deep px-4 py-3.5 text-[15px]">
        {lines.map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-3">
            <dt className="flex flex-col">
              <span className="font-extrabold">{l.name}</span>
              <span className="text-[13px] text-sea-text">
                {l.limit === null
                  ? `You owe ${formatPeso(l.owed)}`
                  : `${formatPeso(l.limit)} limit − ${formatPeso(l.owed)} you owe`}
              </span>
            </dt>
            <dd className="text-right font-extrabold">
              {l.creditLeft === null ? (
                <Link href={`/money/${l.id}`} className="text-white underline underline-offset-4">
                  Set a limit
                </Link>
              ) : (
                `${formatPeso(l.creditLeft)} left`
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="pt-2 text-[13px] leading-snug text-sea-text">
        {cap.status === "unknown" ? (
          <>{cap.reason} </>
        ) : (
          <>
            {cap.status === "paused" && <>{cap.reason} </>}
            You can use what&apos;s left of your limits, but never more than my cap. I work it out
            again every day from your income, spending and installments, so each BNPL purchase
            lowers next month&apos;s cap.{" "}
            {cap.estimated && <>Until you have a full month of records, it&apos;s an estimate. </>}
          </>
        )}
        What you buy with BNPL doesn&apos;t come out of today&apos;s share. Its payments do, once
        they&apos;re due before payday.
      </p>
    </>
  );
}

function BreakdownLine({
  label,
  value,
  strong = false,
  divider = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  divider?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-extrabold" : ""} ${divider ? "border-t border-sea-light pt-1.5" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function pongSays(
  sts: SafeToSpend,
  hasWallets: boolean,
  today: string,
): { mood: PongMood; message: string; link?: { href: string; label: string } } {
  if (!hasWallets) {
    return {
      mood: "ask",
      message: "Add your wallets and payday, and I'll work out how much you can safely spend each day.",
      link: { href: "/setup", label: "Set up wallets" },
    };
  }
  if (!sts.nextPayday || sts.perDay === null) {
    return {
      mood: "listen",
      message: "When's payday? Tell me and I'll spread your money across the days until then.",
      link: { href: "/setup/payday?from=settings", label: "Set payday" },
    };
  }
  if (sts.perDay === 0) {
    return {
      mood: "worried",
      message: `What's due before payday is more than what's in your wallets. Let's go easy until ${formatShortDay(sts.nextPayday, today)}.`,
      link: { href: "/plan", label: "See forecast" },
    };
  }
  if (sts.leftToday !== null && sts.leftToday < 0) {
    return {
      mood: "worried",
      message: `You've gone ${formatPeso(-sts.leftToday)} over today's ${formatPeso(sts.perDay)}. It's okay, let's take it easy tomorrow.`,
    };
  }
  if (sts.daysLeft === 1) {
    return { mood: "proud", message: "Payday's tomorrow! You made it, kaya natin 'to." };
  }
  if (sts.spentToday > 0) {
    return {
      mood: "happy",
      message: `${formatPeso(sts.leftToday!)} left for today. Payday's in ${sts.daysLeft} days.`,
    };
  }
  return {
    mood: "happy",
    message: `Payday's in ${sts.daysLeft} days. Stay under ${formatPeso(sts.perDay)} a day and you're set.`,
  };
}

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3" aria-hidden="true">
      <div className="h-8 w-48 rounded-lg bg-line-soft" />
      <div className="h-11 w-11 rounded-full bg-line-soft" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <div className="h-24 rounded-[20px] bg-line-soft" />
      <div className="h-44 rounded-[28px] bg-line-soft" />
      <div className="h-40 rounded-[20px] bg-line-soft" />
    </div>
  );
}

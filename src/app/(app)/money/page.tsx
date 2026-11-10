import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronIcon } from "@/components/icons";
import {
  getAccounts,
  getInstallmentPlans,
  getLastInterest,
  getPeople,
  getRecurringItems,
  type Account,
  type InstallmentPlan,
} from "@/lib/data";
import { formatShortDay, today as getToday } from "@/lib/dates";
import { getUsdRate } from "@/lib/fx";
import {
  formatPeso,
  isDebt,
  isSpendable,
  pesoTotal,
  roundCents,
} from "@/lib/money";
import { dueDate, isOverdue, type Person } from "@/lib/people";
import { MoneyTabs } from "./money-tabs";
import { WalletManager } from "./wallet-manager";
import { isSavingsWallet, walletInterest } from "./wallet-totals";

export const metadata = { title: "Money · Pong Money" };

// Design canvas 4.1: spending money (cash, banks like MariBank and GoTyme,
// e-wallets like GCash and Maya) and money you owe (SPayLater, Atome, SLoan,
// MariLoan), with net worth. Savings has its own tab. On desktop, Utang &
// pautang sits beside it.
export default function MoneyPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-6xl">
      <h1 className="font-display text-3xl font-semibold">Money</h1>
      <MoneyTabs current="wallets" />
      <Suspense fallback={<div className="h-80 rounded-[20px] bg-line-soft" />}>
        <Wallets />
      </Suspense>
    </div>
  );
}

async function Wallets() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [accounts, plans, recurring, people, lastInterest, usdRate] = await Promise.all([
    getAccounts({ includeArchived: true }),
    getInstallmentPlans(),
    getRecurringItems(),
    getPeople(),
    getLastInterest(),
    getUsdRate(),
  ]);
  const active = accounts.filter((a) => !a.archived);
  const wallets = active.filter((a) => isSpendable(a.type));
  // Savings, emergency fund, investments and dollars are on the Savings tab.
  const saved = wallets.filter(isSavingsWallet);
  const spending = wallets.filter((a) => !isSavingsWallet(a));
  const debts = active.filter((a) => isDebt(a.type));
  const debtGroups = [
    { key: "bnpl", label: "Buy now, pay later", accounts: debts.filter((a) => a.type === "credit_line") },
    { key: "loan", label: "Loans", accounts: debts.filter((a) => a.type === "loan") },
  ].filter((g) => g.accounts.length > 0);

  // Spending wallets can earn interest too (MariBank, GoTyme).
  const { accrued, perMonth: interestPerMonth } = walletInterest(spending, lastInterest, today);
  // You have: spending money only; savings are on their own tab. Net worth
  // still counts everything. Dollars count at the rate set on each wallet.
  const have = pesoTotal(spending);
  const savedTotal = pesoTotal(saved);
  const everything = pesoTotal(wallets);
  // Pautang is still your money; utang is money you owe.
  const owedToYou = roundCents(people.reduce((sum, p) => sum + Math.max(0, p.balance), 0));
  const owe = roundCents(
    debts.reduce((sum, a) => sum + Math.max(0, -a.balance), 0) + people.reduce((sum, p) => sum + Math.max(0, -p.balance), 0),
  );

  // What installments cost per month: the next unpaid payment of each plan. Others' plans on your lines are theirs.
  const perMonth = roundCents(
    plans.filter((p) => !p.personId).reduce((sum, p) => sum + (p.payments.find((x) => !x.transactionId)?.amount ?? 0), 0),
  );
  const payday = recurring.find((r) => r.kind === "payday");
  const payPerMonth = payday?.amount
    ? payday.amount * (payday.frequency === "weekly" ? 52 / 12 : payday.frequency === "twice_monthly" ? 2 : 1)
    : null;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="flex flex-col gap-4">
        {/* Two across on phones, with Net worth under them, so long amounts never get cut. */}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { label: "You have", hint: "Spending money", value: have },
            { label: "You owe", hint: "BNPL, loans, utang", value: owe },
            { label: "Net worth", hint: "Savings and pautang included", value: roundCents(everything + owedToYou - owe), wide: true },
          ].map((s) => (
            <div
              key={s.label}
              className={`flex min-w-0 flex-col gap-0.5 rounded-2xl bg-card px-3.5 py-3 ${s.wide ? "col-span-2 sm:col-span-1" : ""}`}
            >
              <dt className="text-xs font-bold text-muted">{s.label}</dt>
              <dd className={`font-display text-xl font-semibold whitespace-nowrap sm:text-2xl ${s.value < 0 ? "text-coral-text" : ""}`}>
                {formatPeso(s.value)}
              </dd>
              <dd className="text-[11px] leading-tight text-muted">{s.hint}</dd>
            </div>
          ))}
        </dl>

        <Link
          href="/money/savings"
          className="flex min-h-14 items-center gap-3 rounded-[20px] bg-card px-4 py-2.5 text-ink hover:bg-sea-tint"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-bold">Savings</span>
            <span className="text-[13px] text-muted">
              {saved.length
                ? `${saved.length} ${saved.length === 1 ? "wallet" : "wallets"} set aside, not in Safe to spend`
                : "Emergency fund, goals, time deposits"}
            </span>
          </span>
          <span className="font-display text-[17px] font-semibold">{formatPeso(savedTotal)}</span>
          <ChevronIcon size={20} className="text-muted" />
        </Link>

        <section aria-labelledby="have-heading" className="flex flex-col gap-2">
          <h2 id="have-heading" className="text-[13px] font-extrabold text-muted">
            SPENDING MONEY · {formatPeso(pesoTotal(spending))}
            {interestPerMonth > 0 && ` · earning ≈ ${formatPeso(interestPerMonth)}/mo in interest`}
          </h2>
          <WalletManager
            accounts={accounts.filter((a) => (isSpendable(a.type) && !isSavingsWallet(a)) || a.archived)}
            accrued={accrued}
            today={today}
            usdRate={usdRate?.rate ?? null}
            purposes={["spending"]}
          />
        </section>

        <section aria-labelledby="owe-heading" className="flex flex-col gap-2">
          <h2 id="owe-heading" className="text-[13px] font-extrabold text-muted">
            MONEY YOU OWE
            {perMonth > 0 && (
              <>
                {" · "}
                {formatPeso(perMonth)}/mo
                {payPerMonth && ` = ${Math.round((perMonth / payPerMonth) * 100)}% of net pay`}
              </>
            )}
          </h2>
          {debtGroups.map((group) => (
            <section key={group.key} aria-label={group.label} className="flex flex-col gap-1.5">
              {debtGroups.length > 1 && (
                <h3 className="px-1 font-extrabold">
                  {group.label} · {formatPeso(roundCents(group.accounts.reduce((sum, a) => sum + Math.max(0, -a.balance), 0)))}
                </h3>
              )}
              <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
                {group.accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-1 border-b border-line-soft last:border-0">
                    <Link href={`/money/${a.id}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 text-ink">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-bold">{a.name}</span>
                        <span className="text-[13px] text-muted">{debtDetail(a, plans, today)}</span>
                      </span>
                      <span className="font-display text-[17px] font-semibold">{formatPeso(Math.max(0, -a.balance))}</span>
                      <ChevronIcon size={20} className="text-muted" />
                    </Link>
                    {a.type === "credit_line" && (
                      <Link
                        href={`/money/${a.id}?add=upcoming`}
                        aria-label={`Add an upcoming payment to ${a.name}`}
                        title="Add an upcoming payment"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sun font-display text-2xl font-semibold text-ink"
                      >
                        +
                      </Link>
                    )}
                    {a.type === "loan" && (
                      <Link
                        href={`/money/${a.id}?edit=1#edit`}
                        aria-label={`Edit ${a.name}`}
                        className="flex h-11 shrink-0 items-center rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
                      >
                        Edit
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href="/money/credit/new"
              className="flex h-[52px] items-center justify-center rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
            >
              + BNPL &amp; installments (SPayLater, Atome, MariBank)
            </Link>
            <Link
              href="/money/loan/new"
              className="flex h-[52px] items-center justify-center rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
            >
              + Loan (SLoan, MariLoan)
            </Link>
          </div>
          <p className="text-xs text-muted">
            A BNPL purchase is an expense on the day you buy. Paying the bill moves money to the
            credit line, so it&apos;s not spent twice. Only fees and interest count as spending.
          </p>
        </section>
      </div>
      <PeoplePanel people={people} today={today} />
    </div>
  );
}

/** Desktop only: utang and pautang next to your wallets. */
function PeoplePanel({ people, today }: { people: Person[]; today: string }) {
  const open = people.filter((p) => p.balance !== 0).sort((a, b) => b.balance - a.balance);
  return (
    <section aria-labelledby="people-panel-heading" className="hidden flex-col gap-2 lg:flex">
      <div className="flex items-baseline justify-between">
        <h2 id="people-panel-heading" className="font-display text-xl font-semibold">Utang &amp; pautang</h2>
        <Link href="/money/people" className="text-sm font-extrabold text-sea">See all ›</Link>
      </div>
      <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
        {open.slice(0, 8).map((p) => (
          <li key={p.id} className="border-b border-line-soft last:border-0">
            <Link href={`/money/people/${p.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 text-ink">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{p.name}</span>
                <span className={`text-[13px] ${isOverdue(p, today) ? "font-bold text-coral-text" : "text-muted"}`}>
                  {p.balance > 0 ? "Owes you" : "You owe"}
                  {dueDate(p) && ` · ${isOverdue(p, today) ? "was due" : "due"} ${formatShortDay(dueDate(p)!, today)}`}
                </span>
              </span>
              <span className={`font-display text-[17px] font-semibold ${p.balance < 0 ? "text-coral-text" : ""}`}>
                {formatPeso(Math.abs(p.balance))}
              </span>
            </Link>
          </li>
        ))}
        {!open.length && <li className="py-3 text-[15px] text-muted">Nobody owes anybody. All square!</li>}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Link href="/money/people/new" className="flex h-11 items-center justify-center rounded-[16px] bg-sun font-extrabold text-ink">+ Lend / borrow</Link>
        <Link href="/add?split=1" className="flex h-11 items-center justify-center rounded-[16px] border-2 border-sea font-extrabold text-sea-dark">+ Split a bill</Link>
      </div>
    </section>
  );
}

/** "BNPL · ₱4,000 of ₱10,000 used · due Dec 5" or "Loan · 4 of 6 paid · ₱1,900 on Nov 10". */
function debtDetail(account: Account, plans: InstallmentPlan[], today: string): string {
  const mine = plans.filter((p) => p.accountId === account.id);
  const next = mine
    .flatMap((p) => p.payments)
    .filter((p) => !p.transactionId)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  if (account.type === "credit_line") {
    const used = Math.max(0, -account.balance);
    // Everything due on the next bill date, so a new purchase adds to that bill.
    const bill = next
      ? roundCents(
          mine
            .flatMap((p) => p.payments)
            .filter((p) => !p.transactionId && p.dueOn === next.dueOn)
            .reduce((sum, p) => sum + p.amount, 0),
        )
      : 0;
    return [
      "BNPL",
      account.creditLimit ? `${formatPeso(used)} of ${formatPeso(account.creditLimit)} used` : null,
      next ? `${formatPeso(bill)} due ${formatShortDay(next.dueOn, today)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const loan = mine[0];
  const total = loan?.months ?? 0;
  const left = loan?.payments.filter((p) => !p.transactionId).length ?? 0;
  return [
    "Loan",
    loan ? `${total - left} of ${total} paid` : null,
    next ? `${formatPeso(next.amount)} on ${formatShortDay(next.dueOn, today)}` : "paid off",
  ]
    .filter(Boolean)
    .join(" · ");
}

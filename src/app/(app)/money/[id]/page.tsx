import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LogButton } from "@/components/log-button";
import { getAccounts, getInstallmentPlans, getPeople, getScheduledFor, getSplitsPaidWith, getTransactionDates, installmentInputs } from "@/lib/data";
import { addDays, formatShortDay, isValidDate, today as getToday } from "@/lib/dates";
import { scheduledItems, sortItems } from "@/lib/forecast";
import { bnplFirstDue, catchUpDue, dueText, misdatedPlans, statementFor } from "@/lib/installments";
import { formatPeso, isDebt, isSpendable, paysInPesos, roundCents } from "@/lib/money";
import { nextOccurrence } from "@/lib/schedule";
import { readPage, toSplitBill, type SplitBill } from "@/lib/splits";
import { AccountActions, AssignPlanButton, DeleteLoanForGood, FixBillDatesButton, PayBillButton, RemovePlanButton, TheyPaidButton, UpcomingPayments } from "./account-actions";
import { AddSplitsButton } from "./add-splits";
import { WalletActivity } from "./wallet-activity";

export const metadata = { title: "Account · Pong Money" };

// Design canvas 4.2 (SPayLater detail) and the same view for a loan: what
// you owe, the next bill with Pay bill, active plans and upcoming payments.
// A wallet (cash, bank, e-wallet) shows its ins and outs per kinsenas instead.
export default function AccountPage({ params, searchParams }: PageProps<"/money/[id]">) {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <Link href="/money" className="flex h-10 w-fit items-center font-extrabold text-sea-dark">‹ Money</Link>
      <Suspense fallback={<div className="h-[560px] rounded-[20px] bg-line-soft" />}>
        <Account params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Account({ params, searchParams }: PageProps<"/money/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [accounts, plans, splits, people] = await Promise.all([
    getAccounts({ includeArchived: true }),
    getInstallmentPlans(id),
    getSplitsPaidWith(id),
    getPeople({ includeArchived: true }),
  ]);
  const account = accounts.find((a) => a.id === id);
  if (account && isSpendable(account.type)) {
    const p = typeof query.p === "string" && isValidDate(query.p) && query.p <= today ? query.p : today;
    return <WalletActivity account={account} date={p} today={today} page={readPage(query.page)} />;
  }
  if (!account || !isDebt(account.type)) notFound();

  const owed = Math.max(0, roundCents(-account.balance));
  // Plans a split bill made: the whole bill is on the credit line, but only your share is yours.
  const splitOfPlan = new Map<string, SplitBill>();
  // Splits saved before they made a plan: in what you owe, but on no bill yet. Newest first.
  const notOnBill: (SplitBill & { dueOn: string })[] = [];
  for (const [splitId, records] of splits) {
    const plan = plans.find((p) => p.sourceTxnId && records.some((r) => r.id === p.sourceTxnId));
    if (plan) splitOfPlan.set(plan.id, toSplitBill(splitId, records));
    else notOnBill.push({ ...toSplitBill(splitId, records), dueOn: catchUpDue(records[0].occurredOn, account.dueDay, today, account.cutoffDay) });
  }
  notOnBill.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const notOnBillTotal = roundCents(notOnBill.reduce((s, b) => s + b.total, 0));
  const notOnBillDue = [...new Set(notOnBill.map((b) => b.dueOn))];
  const planOfPayment = new Map(plans.flatMap((p) => p.payments.map((x) => [x.id, p.id] as const)));
  // Someone else's plans on this line (Tita Flora used your Atome): who pays each payment.
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const payerOf = (paymentId: string) => {
    const personId = plans.find((p) => p.id === planOfPayment.get(paymentId))?.personId;
    return personId ? { id: personId, name: personName.get(personId) ?? "Someone" } : null;
  };
  // Unpaid installments, late ones first, as forecast items for Mark paid.
  // On a credit line, also what you plan to buy on it (Plan › Scheduled), on the bill it lands on.
  const planned = account.type === "credit_line" ? (await getScheduledFor(account.id, today, 90)).filter((i) => i.boughtOn && !i.transactionId) : [];
  const upcoming = sortItems([
    ...scheduledItems(
      { recurring: [], billPayments: [], planned: [], installments: installmentInputs(plans).filter((p) => !p.transactionId) },
      today,
      "9999-12-31",
    ),
    ...planned,
  ]);
  // One bill per due date: everything due that day, like the provider's monthly statement.
  const bills = [...new Set(upcoming.map((p) => p.dueOn))].map((dueOn) => {
    const items = upcoming.filter((p) => p.dueOn === dueOn);
    return { dueOn, items, total: roundCents(items.reduce((sum, p) => sum + (p.amount ?? 0), 0)) };
  });
  const next = upcoming.find((p) => !p.boughtOn);
  // The bill with the next real payment (one with only planned purchases waits until you buy them).
  const nextDue = bills.find((b) => b.dueOn === next?.dueOn);
  const nextBill = nextDue?.items ?? [];
  const nextTotal = nextDue?.total ?? 0;
  // Pay bill is your part; each person pays theirs. Something you haven't bought yet isn't on it.
  const nextMine = nextBill.filter((p) => !payerOf(p.id) && !p.boughtOn);
  const nextMineTotal = roundCents(nextMine.reduce((sum, p) => sum + (p.amount ?? 0), 0));
  const nextTheirs = [...new Map(nextBill.flatMap((p) => {
    const payer = payerOf(p.id);
    return payer ? [[payer.id, payer] as const] : [];
  })).values()].map((payer) => {
    const items = nextBill.filter((p) => payerOf(p.id)?.id === payer.id);
    return { ...payer, ids: items.map((p) => p.id), total: roundCents(items.reduce((sum, p) => sum + (p.amount ?? 0), 0)) };
  });
  const credit = account.type === "credit_line";
  // What you owe that no upcoming payment covers yet.
  const unscheduled = Math.max(
    0,
    roundCents(owed - plans.flatMap((p) => p.payments).filter((p) => !p.transactionId).reduce((sum, p) => sum + p.principalPart, 0)),
  );
  // A loan's interest isn't in its balance until you pay it, so the card adds what's ahead to show the whole amount.
  const unpaidPayments = plans.flatMap((p) => p.payments).filter((p) => !p.transactionId);
  const interestLeft = roundCents(unpaidPayments.reduce((sum, p) => sum + p.feePart, 0));
  const leftToPay = roundCents(owed + interestLeft);
  const defaultDue = account.dueDay
    ? nextOccurrence({ frequency: "monthly", day1: account.dueDay, day2: null }, today)
    : addDays(today, 30);
  // Purchases on the wrong bill for the cutoff: logged before it was saved, when Pong had to guess.
  const misdated =
    credit && account.cutoffDay && account.dueDay
      ? misdatedPlans(plans, await getTransactionDates(plans.flatMap((p) => (p.sourceTxnId ? [p.sourceTxnId] : []))), account, today)
      : [];
  // With a cutoff day: when this statement closes, and which bill a purchase today lands on.
  const cutoff =
    credit && account.cutoffDay && account.dueDay
      ? { closes: statementFor(today, account.cutoffDay), due: bnplFirstDue(today, account.dueDay, account.cutoffDay) }
      : null;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-display text-3xl font-semibold break-words">{account.name}</h1>
          <span className="text-[15px] text-muted">
            {credit
              ? `Buy now, pay later${account.dueDay ? ` · bill due every ${ordinal(account.dueDay)}` : ""}${account.cutoffDay ? ` · cuts off every ${ordinal(account.cutoffDay)}` : ""}`
              : "Loan"}
            {account.archived && " · archived"}
          </span>
        </div>
        <AccountActions
          account={account}
          loan={
            credit
              ? undefined
              : {
                  // Someone else's too: what they owe you follows its new terms.
                  plan: plans.find((p) => p.kind === "loan") ?? null,
                  paidBy: (() => {
                    const theirs = plans.find((p) => p.kind === "loan")?.personId;
                    return theirs ? (personName.get(theirs) ?? "They") : null;
                  })(),
                  wallets: accounts.filter((a) => paysInPesos(a) && !a.archived),
                  today,
                }
          }
          startEditing={query.edit === "1"}
        />
      </div>

      {cutoff && (
        <p className="-mt-1 rounded-[16px] bg-sea-tint px-4 py-2.5 text-[15px] leading-snug">
          {cutoff.closes === today ? "Statement closes today. " : `Statement closes ${formatShortDay(cutoff.closes, today)} (${dueText(cutoff.closes, today).replace("Due ", "").toLowerCase()}). `}
          Buy now and you pay on <strong>{formatShortDay(cutoff.due, today)}</strong>; after the cutoff, it waits for
          the {formatShortDay(bnplFirstDue(addDays(cutoff.closes, 1), account.dueDay!, account.cutoffDay!), today)} bill.
        </p>
      )}

      {misdated.length > 0 && (
        <section aria-label="On the wrong bill" className="flex flex-col gap-2 rounded-[20px] bg-sun-tint px-4 py-3.5">
          <p className="text-[15px] leading-snug">
            <strong>{misdated.length === 1 ? "This is" : `These ${misdated.length} are`} on the wrong bill</strong> for your
            cutoff on the {ordinal(account.cutoffDay!)}. Logged before the cutoff was saved, I had to guess.
          </p>
          <ul className="flex flex-col gap-1 text-[15px]">
            {misdated.map((m) => (
              <li key={m.planId}>
                <strong>{m.name}</strong>, bought {formatShortDay(m.purchasedOn, today)}: the{" "}
                {formatShortDay(m.to, today)} bill, not {formatShortDay(m.from, today)}
              </li>
            ))}
          </ul>
          <FixBillDatesButton lineId={account.id} count={misdated.length} />
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-[28px] bg-sea p-6 text-white">
        {credit && account.creditLimit ? (
          <>
            <div className="flex justify-between text-sm font-bold text-sea-text"><span>USED</span><span>LIMIT</span></div>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-4xl font-semibold">{formatPeso(owed)}</span>
              <span className="font-display text-xl font-semibold">{formatPeso(account.creditLimit)}</span>
            </div>
            <div
              role="progressbar"
              aria-label="Credit used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round((owed / account.creditLimit) * 100))}
              className="h-2.5 overflow-hidden rounded-full bg-sea-deep"
            >
              <div className="h-full rounded-full bg-sun" style={{ width: `${Math.min(100, (owed / account.creditLimit) * 100)}%` }} />
            </div>
            <span className="text-[15px] text-sea-text">
              Available: {formatPeso(Math.max(0, account.creditLimit - owed))}
            </span>
          </>
        ) : !credit && interestLeft > 0 ? (
          <>
            <h2 className="text-sm font-bold text-sea-text">LEFT TO PAY</h2>
            <span className="font-display text-4xl font-semibold">{formatPeso(leftToPay)}</span>
            <span className="text-[15px] text-sea-text">
              {formatPeso(owed)} loan + {formatPeso(interestLeft)} interest · {unpaidPayments.length} payment
              {unpaidPayments.length === 1 ? "" : "s"} left
            </span>
          </>
        ) : (
          <>
            <h2 className="text-sm font-bold text-sea-text">YOU STILL OWE</h2>
            <span className="font-display text-4xl font-semibold">{formatPeso(owed)}</span>
            <span className="text-[15px] text-sea-text">
              {credit ? "No limit saved" : "Principal left. Interest is counted as you pay."}
            </span>
          </>
        )}
      </section>

      {next && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-card px-4 py-3.5">
          <div className="flex flex-col">
            <span className={`text-[13px] font-bold ${next.dueOn < today ? "text-coral-text" : "text-muted"}`}>
              Next bill · {formatShortDay(next.dueOn, today)} · {dueText(next.dueOn, today)}
              {nextBill.length > 1 && ` · ${nextBill.length} items`}
            </span>
            <span className="font-display text-2xl font-semibold">{formatPeso(nextTotal)}</span>
          </div>
          {nextMine.length > 0 && <PayBillButton ids={nextMine.map((p) => p.id)} total={nextMineTotal} />}
          {nextTheirs.map((t) => (
            <div key={t.id} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line-soft pt-2.5">
              <span className="min-w-0 flex-1 basis-40 text-[15px]">
                <strong>{t.name}</strong> pays {formatPeso(t.total)} of this bill
              </span>
              <TheyPaidButton ids={t.ids} label={`${t.name} paid`} />
            </div>
          ))}
        </section>
      )}
      <p className="-mt-2 text-xs leading-relaxed text-muted">
        Pay bill = a transfer from your wallet to {account.name}. It&apos;s not a new expense: the
        expense was logged when you {credit ? "bought the item" : "spent the money"}. Only the fee or
        interest part is an expense.
      </p>

      {credit && !account.archived && (
        <UpcomingPayments
          account={account}
          unscheduled={unscheduled}
          defaultDue={defaultDue}
          today={today}
          startOpen={query.add === "upcoming"}
        />
      )}

      <section aria-labelledby="plans-heading" className="flex flex-col gap-2">
        <h2 id="plans-heading" className="font-display text-xl font-semibold">{credit ? "Active plans" : "Payment plan"}</h2>
        <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
          {plans.map((plan) => {
            const unpaid = plan.payments.filter((p) => !p.transactionId);
            const paidCount = plan.months - unpaid.length;
            const each = plan.payments[0]?.amount ?? 0;
            const payer = plan.personId ? (personName.get(plan.personId) ?? "Someone") : null;
            const left = roundCents(unpaid.reduce((sum, p) => sum + p.principalPart, 0));
            return (
              <li key={plan.id} className="flex flex-col gap-2 border-b border-line-soft py-2.5 last:border-0">
                {/* Name and details get the width; the amount and Remove stack on the right. */}
                <div className="flex items-start gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-bold break-words">{plan.name}</span>
                    <span className="text-[13px] text-muted">
                      {plan.months === 1 ? "One payment" : `${plan.months} months`} · {paidCount} of {plan.months} paid
                      {plan.feeTotal > 0 && ` · fees ${formatPeso(plan.feeTotal)}`}
                      {splitOfPlan.has(plan.id) && ` · split bill`}
                    </span>
                    {payer && plan.personId && (
                      <Link href={`/money/people/${plan.personId}`} className="w-fit text-[13px] font-extrabold text-sea-dark">
                        {payer} pays this · not in your forecast
                      </Link>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="font-display text-[17px] font-semibold whitespace-nowrap">
                      {formatPeso(each)}{plan.months > 1 && <span className="text-sm text-muted">/mo</span>}
                    </span>
                    <RemovePlanButton id={plan.id} name={plan.name} />
                  </span>
                </div>
                {!payer && !splitOfPlan.has(plan.id) && left > 0 && (
                  <AssignPlanButton
                    planId={plan.id}
                    name={plan.name}
                    left={left}
                    interest={roundCents(unpaid.reduce((sum, p) => sum + p.feePart, 0))}
                    loan={plan.kind === "loan" ? { movesMoney: Boolean(plan.sourceTxnId) && paidCount === 0 } : null}
                    people={people.map((p) => ({ id: p.id, name: p.name }))}
                  />
                )}
              </li>
            );
          })}
          {!plans.length && (
            <li className="py-3 text-[15px] text-muted">
              {credit
                ? "No plans yet. Log a purchase with + and pay with this credit line, or add a bill you expect with + Upcoming payment."
                : "No payments scheduled."}
            </li>
          )}
        </ul>
      </section>

      {credit && notOnBill.length > 0 && (
        <section aria-labelledby="splits-heading" className="flex flex-col gap-2">
          <h2 id="splits-heading" className="font-display text-xl font-semibold">Split bills not on a bill yet</h2>
          <div className="flex flex-col gap-3 rounded-[20px] bg-card px-4 py-3.5">
            <p className="text-sm leading-snug text-muted">
              You split {notOnBill.length === 1 ? "this" : `these ${notOnBill.length}`} with {account.name} before splits
              went on its bill. {formatPeso(notOnBillTotal)} is in what you owe, but not in Pay bill or your forecast yet.
            </p>
            <ul className="flex flex-col gap-3">
              {notOnBill.map((split) => (
                <li key={split.splitId} className="flex flex-col gap-2">
                  <span className="flex flex-col">
                    <span className="truncate font-bold">{split.title}</span>
                    <span className="text-[13px] text-muted">
                      {formatShortDay(split.occurredOn, today)} · split with {split.others.length} · goes on the{" "}
                      {formatShortDay(split.dueOn, today)} bill
                    </span>
                  </span>
                  <SplitBreakdown split={split} />
                </li>
              ))}
            </ul>
            <AddSplitsButton
              splitIds={notOnBill.map((b) => b.splitId)}
              label={
                notOnBillDue.length === 1
                  ? `Add ${notOnBill.length === 1 ? "it" : `all ${notOnBill.length}`} to the ${formatShortDay(notOnBillDue[0], today)} bill · ${formatPeso(notOnBillTotal)}`
                  : `Add all ${notOnBill.length} to their bills · ${formatPeso(notOnBillTotal)}`
              }
            />
          </div>
        </section>
      )}

      {bills.length > 0 && (
        <section aria-labelledby="upcoming-heading" className="flex flex-col gap-2">
          <h2 id="upcoming-heading" className="font-display text-xl font-semibold">
            {credit ? "Bills by due date" : "Upcoming payments"}
          </h2>
          {bills.slice(0, 8).map((bill) => (
            <section
              key={bill.dueOn}
              aria-label={`${formatShortDay(bill.dueOn, today)} bill`}
              className="flex flex-col rounded-[20px] bg-card px-4 py-1.5"
            >
              <div className="flex items-baseline justify-between gap-3 border-b-2 border-line-soft py-2.5">
                <span className="flex flex-col">
                  <span className="font-display text-lg font-semibold">{formatShortDay(bill.dueOn, today)} bill</span>
                  <span className={`text-[13px] ${bill.dueOn < today ? "font-bold text-coral-text" : "text-muted"}`}>
                    {dueText(bill.dueOn, today)}
                    {bill.items.length > 1 && ` · ${bill.items.length} items`}
                  </span>
                </span>
                <span className="font-display text-2xl font-semibold">{formatPeso(bill.total)}</span>
              </div>
              <ul className="flex flex-col">
                {bill.items.map((item) => {
                  const split = splitOfPlan.get(planOfPayment.get(item.id) ?? "");
                  const payer = payerOf(item.id);
                  return (
                    <li key={item.key} className="flex flex-col gap-2 border-b border-line-soft py-2.5 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-bold">{item.name}</span>
                          {split && <span className="text-[13px] text-muted">Split bill · {split.others.length + (split.mine ? 1 : 0)} people</span>}
                          {payer && <span className="text-[13px] font-bold text-sea-dark">{payer.name} pays this</span>}
                          {item.boughtOn && (
                            <span className="text-[13px] text-muted">
                              {item.kind === "planned" ? "Planned" : "Repeating bill"} · {item.boughtOn < today ? "bought" : "buying"}{" "}
                              {formatShortDay(item.boughtOn, today)}
                            </span>
                          )}
                        </span>
                        <span className="font-display text-[17px] font-semibold">{formatPeso(item.amount ?? 0)}</span>
                        {item.boughtOn ? (
                          // Not bought yet: once you do, log it with + on this line and remove the plan.
                          <Link
                            href={`/plan/scheduled?edit=${item.id}`}
                            aria-label={`Edit ${item.name}`}
                            className="flex h-10 shrink-0 items-center rounded-full px-3 text-[13px] font-extrabold text-sea-dark hover:bg-mint"
                          >
                            Edit
                          </Link>
                        ) : payer ? (
                          <TheyPaidButton ids={[item.id]} label="They paid" />
                        ) : (
                          <LogButton item={item} accounts={accounts} />
                        )}
                      </div>
                      {split && <SplitBreakdown split={split} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="text-xs text-muted">
            {credit
              ? `A purchase you log with + lands on the bill it's due with, and that bill's total goes up. So does one you plan in Plan › Scheduled with Paid from ${account.name}, by its statement cutoff. All of these are in your forecast and Safe to spend${plans.some((p) => p.personId) ? ", except what someone else pays: their money goes straight to the bill" : ""}.`
              : "All of these are in your forecast and Safe to spend."}
          </p>
        </section>
      )}

      {!credit && <DeleteLoanForGood account={account} />}
    </>
  );
}

/** Under a bill item that's a split: the whole bill on the credit line, and the part that's yours. */
function SplitBreakdown({ split }: { split: SplitBill }) {
  const mine = split.mine?.amount ?? 0;
  return (
    <Link
      href={`/activity/split/${split.splitId}`}
      className="flex flex-col rounded-[16px] bg-mint px-3.5 py-1 hover:bg-sea-tint"
    >
      <span className="flex items-center justify-between gap-3 border-b border-line-soft py-2">
        <span className="text-[15px] font-bold">Total bill</span>
        <span className="font-display text-[17px] font-semibold">{formatPeso(split.total)}</span>
      </span>
      <span className="flex items-center justify-between gap-3 py-2">
        <span className="flex flex-col">
          <span className="text-[15px] font-bold">My share</span>
          <span className="text-xs text-muted">The other {formatPeso(roundCents(split.total - mine))} is pautang</span>
        </span>
        <span className="font-display text-[17px] font-semibold text-sea-dark">{formatPeso(mine)}</span>
      </span>
    </Link>
  );
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

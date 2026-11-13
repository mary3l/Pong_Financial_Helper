import Link from "next/link";
import { PaidInAdvanceTag } from "@/components/paid-in-advance-tag";
import { billCalendar } from "@/lib/bill-calendar";
import { DEBT_SHARE } from "@/lib/bnpl";
import type { Account } from "@/lib/data";
import { formatShortDay } from "@/lib/dates";
import { formatCutoff } from "@/lib/payroll";
import type { ForecastItem } from "@/lib/forecast";
import { formatPeso } from "@/lib/money";
import type { PaydayBills } from "@/lib/office-days";
import { groupByPayee, type PayTo, type PeriodPayments } from "@/lib/pay-periods";
import { BillCalendarView, BillsViewSection } from "./bills-view";

// Plan's payment sections: Bills by payday and BNPL & loan payments. Each
// card shows how much goes where first; every payment is behind a tap.

/** Every BNPL and loan payment, a month at a time from payday: how much to pay where, against the pay that comes in. */
export function PaymentsByPeriod({ periods, accounts, today }: { periods: PeriodPayments[]; accounts: Account[]; today: string }) {
  const lenderName = (id: string) => accounts.find((a) => a.id === id)?.name;
  return (
    <section aria-labelledby="periods-heading" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 id="periods-heading" className="font-display text-xl font-semibold">BNPL &amp; loan payments</h2>
        <p className="text-[13px] text-muted">How much goes to each, a month at a time from payday.</p>
      </div>
      <div className="flex flex-col gap-2">
        {periods.map((p) => {
          const percent = p.share === null ? null : Math.round(p.share * 100);
          const level = p.share === null ? null : p.share > 0.5 ? "high" : p.share > DEBT_SHARE ? "mid" : "ok";
          const groups = groupByPayee(p.payments, lenderName, today);
          return (
            <article key={p.from} aria-label={`${formatShortDay(p.from, today)} to ${formatShortDay(p.to, today)}`} className="flex flex-col gap-2.5 rounded-[20px] bg-card px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-bold">
                  {formatShortDay(p.from, today)} – {formatShortDay(p.to, today)}
                </h3>
                <span className="font-display text-[22px] font-semibold">{formatPeso(p.total)}</span>
              </div>
              {percent !== null ? (
                <div className="flex flex-col gap-1">
                  <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-line-soft">
                    <span
                      className={`block h-full rounded-full ${level === "high" ? "bg-coral" : level === "mid" ? "bg-sun" : "bg-sea"}`}
                      style={{ width: `${Math.min(100, percent)}%` }}
                    />
                  </span>
                  <p className={`text-[13px] ${level === "high" ? "font-bold text-coral-text" : "text-muted"}`}>
                    {percent}% of your {formatPeso(p.income)} pay.{" "}
                    {level === "high"
                      ? "Over half: hold off on new installments."
                      : level === "mid"
                        ? `Above Pong's ${Math.round(DEBT_SHARE * 100)}% guide.`
                        : `Within Pong's ${Math.round(DEBT_SHARE * 100)}% guide.`}
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-muted">{p.payments.length ? "No pay comes in these days." : "Nothing due."}</p>
              )}
              {groups.length > 0 && <PayeeList groups={groups} today={today} />}
              {p.payments.length > 1 && <ItemList label={`See all ${p.payments.length} payments`} items={p.payments} today={today} />}
            </article>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Installments and loan payments set up in Pong. Bills are in What&apos;s coming, and split
        bills that aren&apos;t on a credit line&apos;s bill yet aren&apos;t here. Pay is your
        Payroll estimate until it comes in.
      </p>
    </section>
  );
}

/** Totals by where the money goes, soonest first: each credit line or loan, or each bill. */
function PayeeList({ groups, today }: { groups: PayTo[]; today: string }) {
  return (
    <ul className="flex flex-col rounded-[16px] bg-mint px-3 py-1">
      {groups.map((g) => {
        const when =
          g.firstDue === g.lastDue
            ? `${g.late ? "Was due" : "Due"} ${formatShortDay(g.firstDue, today)}`
            : `${formatShortDay(g.firstDue, today)} – ${formatShortDay(g.lastDue, today)}`;
        const body = (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-bold">{g.name}</span>
              <span className={`text-[13px] ${g.late ? "font-bold text-coral-text" : "text-muted"}`}>
                {when}
                {g.count > 1 && ` · ${g.count} payments`}
              </span>
            </span>
            <span className="shrink-0 font-display text-[17px] font-semibold">{formatPeso(g.total)}</span>
          </>
        );
        return (
          <li key={g.key} className="border-b border-line-soft last:border-0">
            {g.lenderId ? (
              <Link href={`/money/${g.lenderId}`} className="flex min-h-12 items-center gap-3 py-2 text-ink">
                {body}
              </Link>
            ) : g.editId ? (
              <div className="flex min-h-12 items-center gap-2 py-2">
                {body}
                <Link
                  href={`/plan/scheduled?edit=${g.editId}`}
                  aria-label={`Edit ${g.name}`}
                  className="flex h-9 shrink-0 items-center rounded-full px-2.5 text-[13px] font-extrabold text-sea-dark hover:bg-card"
                >
                  Edit
                </Link>
              </div>
            ) : (
              <div className="flex min-h-12 items-center gap-3 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Every payment on its own, behind a tap. */
function ItemList({ label, items, today }: { label: string; items: ForecastItem[]; today: string }) {
  return (
    <details className="group">
      <summary className="flex min-h-10 cursor-pointer list-none items-center text-[13px] font-extrabold text-sea-dark [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Hide them</span>
      </summary>
      <ul className="flex flex-col border-t border-line-soft">
        {items.map((item) => {
          const late = item.dueOn < today;
          return (
            <li key={item.key} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-line-soft py-2 last:border-0">
              <span className={`text-xs font-extrabold uppercase ${late ? "text-coral-text" : "text-muted"}`}>
                {late ? "Late" : formatShortDay(item.dueOn, today)}
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="truncate font-bold">
                  {item.name}
                  {item.estimate && <span className="font-normal text-muted"> (est.)</span>}
                </span>
                {item.lastPayment && (
                  <span className="rounded-full bg-sea-tint px-2 text-xs font-extrabold text-sea-dark">Last payment</span>
                )}
                {item.boughtOn && <span className="text-xs text-muted">bought {formatShortDay(item.boughtOn, today)}</span>}
              </span>
              <span className="text-right font-display text-[17px] font-semibold">{formatPeso(item.amount ?? 0)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Each pay with the bills it covers, and how many days to go in during its cutoff to cover them. */
export function BillsByPayday({ periods, accounts, today }: { periods: PaydayBills[]; accounts: Account[]; today: string }) {
  const withOffice = periods.some((p) => p.office);
  const lenderName = (id: string) => accounts.find((a) => a.id === id)?.name;
  return (
    <section aria-labelledby="by-payday-heading">
      <BillsViewSection
        heading={
          <div className="flex flex-col gap-0.5">
            <h2 id="by-payday-heading" className="font-display text-xl font-semibold">Bills by payday</h2>
            <p className="text-[13px] text-muted">
              {withOffice
                ? "Each pay covers the bills until the next one. Go in at least this many days in its cutoff to cover them."
                : "Each pay covers the bills until the next one."}
            </p>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          {periods.map((p) => (
            <PaydayCard key={p.from} period={p} today={today} lenderName={lenderName} />
          ))}
        </div>
        <p className="text-xs text-muted">
          Bills, installments, loan payments and utang in your forecast; day-to-day spending isn&apos;t in it.
          {withOffice && (
            <>
              {" "}Days off and leave you saved in the{" "}
              <Link href="/payroll" className="font-extrabold text-sea-dark underline">Payroll calculator</Link> are left out
              of the days you can still go in.
            </>
          )}
        </p>
      </BillsViewSection>
    </section>
  );
}

function PaydayCard({
  period: p,
  today,
  lenderName,
}: {
  period: PaydayBills;
  today: string;
  lenderName: (id: string) => string | undefined;
}) {
  const office = p.office;
  const short = office ? office.needed === null : p.left !== null && p.left < 0;
  const range = `${formatShortDay(p.from, today)} – ${formatShortDay(p.to, today)}`;
  const cutoffRange = p.cutoff && office?.firstDay ? `${formatShortDay(office.firstDay, today)} – ${formatShortDay(p.cutoff.end, today)}` : null;
  const groups = groupByPayee(p.bills, lenderName, today);
  const calendar = billCalendar({ from: p.from, to: p.to, payday: p.payday, pay: p.money, bills: p.bills, today, lenderName });
  const details = Object.fromEntries(
    calendar.days.filter((d) => d.count > 0).map((d) => [d.date, <PayeeList key={d.date} groups={d.bills} today={today} />]),
  );
  return (
    <article aria-label={p.payday ? `${formatShortDay(p.payday, today)} pay` : "Before payday"} className="flex flex-col gap-2.5 rounded-[20px] bg-card px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <h3 className="font-bold">{p.payday ? `${formatShortDay(p.payday, today)} pay` : "Before payday"}</h3>
          <span className="text-[13px] text-muted">covers {range}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-display text-[22px] font-semibold">{formatPeso(p.total)}</span>
          <span className="text-xs text-muted">{p.bills.length} {p.bills.length === 1 ? "bill" : "bills"}</span>
        </span>
      </div>

      {office ? (
        <p className={`rounded-[14px] px-3 py-2 text-[15px] ${short ? "bg-coral-tint" : "bg-sea-tint"}`}>
          {office.needed === null ? (
            <>
              <strong className="text-coral-text">{formatPeso(office.short)} short</strong> even going in all{" "}
              {office.daysLeft} {office.daysLeft === 1 ? "day" : "days"} left
            </>
          ) : office.needed === 0 ? (
            <><strong>Covered</strong> by what you&apos;ve earned in its cutoff{p.cutoff && <span className="text-muted"> · {formatCutoff(p.cutoff, today)}</span>}</>
          ) : (
            <>
              Go in <strong>{office.needed} of {office.daysLeft}</strong> {office.daysLeft === 1 ? "day" : "days"} left
              {cutoffRange && <span className="text-muted"> · {cutoffRange}</span>}
            </>
          )}
        </p>
      ) : (
        p.money !== null && (
          <p className={`rounded-[14px] px-3 py-2 text-[15px] ${short ? "bg-coral-tint" : "bg-sea-tint"}`}>
            {p.left! < 0 ? (
              <><strong className="text-coral-text">{formatPeso(-p.left!)} short</strong> of {formatPeso(p.money)} {p.payday ? "pay" : "in your wallets"}</>
            ) : (
              <><strong>{formatPeso(p.left!)} left</strong> of {formatPeso(p.money)} {p.payday ? "pay" : "in your wallets"}</>
            )}
          </p>
        )
      )}

      <div className="contents group-data-[view=calendar]/bills:hidden">
        {groups.length > 0 && <PayeeList groups={groups} today={today} />}
      </div>
      <div className="hidden group-data-[view=calendar]/bills:contents">
        <BillCalendarView
          days={calendar.days}
          weekStart={calendar.weekStart}
          blanks={calendar.blanks}
          pay={p.payday ? p.money : null}
          details={details}
          late={
            calendar.late.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="flex justify-between gap-3 text-[13px] font-extrabold text-coral-text">
                  <span>Late</span>
                  <span>{formatPeso(calendar.lateTotal)}</span>
                </h4>
                <PayeeList groups={calendar.late} today={today} />
              </div>
            )
          }
        />
      </div>

      {p.paidEarly.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-[13px] font-extrabold text-muted">Already paid in advance · not counted</h4>
          <ul className="flex flex-col">
            {p.paidEarly.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-1 text-[15px]">
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span className="truncate font-bold">{item.name}</span>
                    <PaidInAdvanceTag paidOn={item.paidOn!} today={today} />
                  </span>
                  <span className="text-xs text-muted">
                    Due {formatShortDay(item.dueOn, today)} · paid {formatShortDay(item.paidOn!, today)}
                  </span>
                </span>
                <span className="shrink-0 font-bold text-muted line-through decoration-1">{formatPeso(item.amount ?? 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="flex flex-col gap-1 text-[13px]">
        {p.carriedIn > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Carried from the pay before</dt>
            <dd className="font-bold text-coral-text">+{formatPeso(p.carriedIn)}</dd>
          </div>
        )}
        {p.otherIncome > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Other money coming in</dt>
            <dd className="font-bold">−{formatPeso(p.otherIncome)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="font-bold">{p.payday ? "This pay has to cover" : "To pay before payday"}</dt>
          <dd className="font-bold">{formatPeso(p.need)}</dd>
        </div>
        {office && (
          <>
            {office.earned > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Earned in its cutoff{p.cutoff ? ` (${formatCutoff(p.cutoff, today)})` : ""}{office.daysLeft ? " so far" : ""}</dt>
                <dd>{formatPeso(office.earned)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Each day you go in</dt>
              <dd>+{formatPeso(office.dailyRate)}</dd>
            </div>
            {p.money !== null && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Going in every day, after bills</dt>
                <dd className={p.left! < 0 ? "font-bold text-coral-text" : ""}>{formatPeso(p.left!)}</dd>
              </div>
            )}
          </>
        )}
      </dl>

      {p.bills.length > 1 && (
        <div className="contents group-data-[view=calendar]/bills:hidden">
          <ItemList label={`See all ${p.bills.length} bills`} items={p.bills} today={today} />
        </div>
      )}
    </article>
  );
}

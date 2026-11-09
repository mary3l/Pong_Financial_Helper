"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addLoan } from "@/app/credit-actions";
import { addLoanForPerson } from "@/app/people-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import type { Account } from "@/lib/data";
import { formatShortDay, isValidDate } from "@/lib/dates";
import { monthlyDates } from "@/lib/forecast";
import { loanSchedule, loanSummary, runningLoan } from "@/lib/installments";
import { formatPeso, parseAmount, parseExactAmount, roundCents } from "@/lib/money";

const PROVIDERS = ["SLoan", "MariLoan", "GLoan", "Pag-IBIG", "SSS"];

/** Just got the money, or got it before and already paying monthly. */
type Mode = "new" | "running";

export function LoanForm({
  wallets,
  people,
  today,
}: {
  wallets: Account[];
  people: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("new");
  // In your name but someone else's (Tita Flora's MariLoan): they got the money and pay it, interest included.
  const [forOther, setForOther] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [name, setName] = useState("SLoan");
  const [received, setReceived] = useState("");
  const [into, setInto] = useState(wallets[0]?.id ?? "");
  const [receivedOn, setReceivedOn] = useState(today);
  const [monthly, setMonthly] = useState("");
  const [months, setMonths] = useState("12");
  const [firstDue, setFirstDue] = useState(monthlyDates(today, 2)[1]);
  const [payFrom, setPayFrom] = useState(wallets[0]?.id ?? "");
  // Counted from the due dates until you change it.
  const [paidOverride, setPaidOverride] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const terms = {
    received: parseAmount(received),
    monthly: parseExactAmount(monthly),
    months: Number(months),
  };
  const running = mode === "running";
  const monthsOk = Number.isInteger(terms.months) && terms.months >= 1 && terms.months <= 60;
  const datesOk = monthsOk && isValidDate(firstDue);
  const autoPaid = running && datesOk ? runningLoan(firstDue, terms.months, today).paid : 0;
  const paid = running ? (paidOverride ?? autoPaid) : 0;
  const nextDue = running && datesOk ? monthlyDates(firstDue, paid + 1)[paid] : firstDue;
  const valid = terms.received > 0 && terms.monthly > 0 && datesOk && paid < terms.months;
  const summary = valid ? loanSummary(terms) : null;
  const schedule = valid ? loanSchedule(terms, nextDue, paid) : [];
  const owedNow = roundCents(schedule.reduce((sum, r) => sum + r.principalPart, 0));
  const leftToPay = roundCents(schedule.reduce((sum, r) => sum + r.amount, 0));
  const fullyPaid = running && datesOk && paid >= terms.months;

  const search = typed.trim().toLowerCase();
  const matches = search ? people.filter((p) => p.name.toLowerCase().includes(search)) : people;
  const exact = people.find((p) => p.name.toLowerCase() === search);
  const who = personId ? people.find((p) => p.id === personId)?.name : (exact?.name ?? typed.trim());

  function pickMode(next: Mode) {
    setMode(next);
    setPaidOverride(null);
    setError(null);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!valid) {
      const amountLabel = running ? "loan amount" : "amount received";
      setError(
        !received.trim() || !monthly.trim()
          ? `Fill in the ${amountLabel} and the monthly payment.`
          : !(terms.received > 0)
            ? `Check the ${amountLabel}: a number with up to 2 decimals.`
            : !(terms.monthly > 0)
              ? "Check the monthly payment: a number with up to 4 decimals."
              : !monthsOk
                ? "Months should be a whole number from 1 to 60."
                : fullyPaid
                  ? "Every payment's due date has passed, so this loan looks paid off. Check the first due date or payments made."
                  : `Pick when the ${running ? "1st payment was" : "first payment is"} due.`,
      );
      return;
    }
    if (forOther) {
      if (!personId && !search) {
        setError("Who is the loan for? Pick someone or type a name.");
        return;
      }
      startTransition(async () => {
        const result = await addLoanForPerson({
          who: personId ? { personId } : exact ? { personId: exact.id } : { name: typed },
          name,
          ...terms,
          receivedOn,
          nextDue,
          alreadyPaid: paid,
        });
        if (result.error) setError(result.error);
        else router.push(`/money/${result.loanId}`);
      });
      return;
    }
    startTransition(async () => {
      const result = await addLoan({
        name,
        ...terms,
        // Got it before using the app: no transfer in, the loan starts at what's still owed.
        intoAccountId: running ? null : into || null,
        receivedOn,
        nextDue,
        payFromAccountId: payFrom || null,
        alreadyPaid: paid,
      });
      if (result.error) setError(result.error);
      else router.push(`/money/${result.id}`);
    });
  }

  const money = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <div className="relative">
        <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
        <AmountInput id={id} value={value} onChange={set} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
      </div>
    </div>
  );

  const dateField = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <input id={id} type="date" value={value} onChange={(e) => set(e.target.value)} className={FIELD_CLASS} />
    </div>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div role="group" aria-label="New or existing loan" className="grid grid-cols-2 gap-1 rounded-2xl bg-card p-1">
        {(["new", "running"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => pickMode(m)}
            className={`h-10 rounded-xl text-sm ${mode === m ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"}`}
          >
            {m === "new" ? "New loan" : "Existing loan"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-[20px] bg-card p-4">
        <span id="loan-for-label" className="text-sm font-bold">Whose loan is it?</span>
        <div role="group" aria-labelledby="loan-for-label" className="grid grid-cols-2 gap-1 rounded-2xl bg-mint p-1">
          {[false, true].map((other) => (
            <button
              key={String(other)}
              type="button"
              aria-pressed={forOther === other}
              onClick={() => setForOther(other)}
              className={`h-10 rounded-xl text-sm ${forOther === other ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"}`}
            >
              {other ? "Someone else's, in my name" : "Mine"}
            </button>
          ))}
        </div>
        {forOther && (
          <>
            <label htmlFor="loan-who" className="text-sm font-bold">Who got the money and pays it?</label>
            <input
              id="loan-who"
              value={personId ? (people.find((p) => p.id === personId)?.name ?? "") : typed}
              onChange={(e) => {
                setPersonId(null);
                setTyped(e.target.value);
              }}
              maxLength={60}
              placeholder="Search or add a person"
              className={FIELD_CLASS}
            />
            {matches.length > 0 && (
              <div role="group" aria-label="People" className="flex flex-wrap gap-2">
                {matches.slice(0, 8).map((p) => (
                  <ChoiceChip
                    key={p.id}
                    selected={personId === p.id}
                    onClick={() => {
                      setPersonId(p.id);
                      setTyped("");
                    }}
                    className={personId === p.id ? "" : "bg-mint"}
                  >
                    {p.name}
                  </ChoiceChip>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div role="group" aria-label="Lender" className="flex flex-wrap gap-2">
        {[...PROVIDERS, "Other"].map((p) => {
          const selected = p === "Other" ? !PROVIDERS.includes(name) : name === p;
          return (
            <ChoiceChip key={p} selected={selected} onClick={() => setName(p === "Other" ? "" : p)} className={selected ? "" : "bg-card"}>
              {p}
            </ChoiceChip>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="loan-name" className="text-sm font-bold">Name</label>
          <input id="loan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={FIELD_CLASS} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {money("loan-received", running ? "Loan amount" : "Amount received", received, setReceived)}
          {running ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="loan-months" className="text-sm font-bold">Months</label>
              <input
                id="loan-months"
                value={months}
                onChange={(e) => {
                  setMonths(e.target.value);
                  setPaidOverride(null);
                }}
                inputMode="numeric"
                className={FIELD_CLASS}
              />
            </div>
          ) : forOther ? (
            dateField("loan-date", `${who || "They"} got it on`, receivedOn, setReceivedOn)
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="loan-into" className="text-sm font-bold">Received into</label>
              <select id="loan-into" value={into} onChange={(e) => setInto(e.target.value)} className={FIELD_CLASS}>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
                <option value="">Don&apos;t add to a wallet (already spent)</option>
              </select>
            </div>
          )}
          {money("loan-monthly", "Monthly payment", monthly, setMonthly)}
          {running ? (
            dateField("loan-first", "1st payment was due", firstDue, (v) => {
              setFirstDue(v);
              setPaidOverride(null);
            })
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="loan-months" className="text-sm font-bold">Months</label>
              <input id="loan-months" value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" className={FIELD_CLASS} />
            </div>
          )}
          {running ? (
            <div className="flex flex-col gap-1">
              <span id="loan-paid-label" className="text-sm font-bold">Payments made</span>
              <div role="group" aria-labelledby="loan-paid-label" className="flex h-12 items-center justify-between rounded-[14px] border-2 border-line px-1">
                <button
                  type="button"
                  aria-label="One fewer payment made"
                  disabled={paid <= 0}
                  onClick={() => setPaidOverride(Math.max(0, paid - 1))}
                  className="h-9 w-9 rounded-[10px] text-xl font-extrabold text-sea-dark hover:bg-sea-tint disabled:opacity-30"
                >
                  &minus;
                </button>
                <span aria-live="polite" className="font-extrabold">
                  {paid}{monthsOk && <span className="font-bold text-muted"> of {terms.months}</span>}
                </span>
                <button
                  type="button"
                  aria-label="One more payment made"
                  disabled={!monthsOk || paid >= terms.months - 1}
                  onClick={() => setPaidOverride(paid + 1)}
                  className="h-9 w-9 rounded-[10px] text-xl font-extrabold text-sea-dark hover:bg-sea-tint disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          ) : (
            dateField("loan-next", "First due", firstDue, setFirstDue)
          )}
          {forOther && running && dateField("loan-date", `${who || "They"} got it on`, receivedOn, setReceivedOn)}
          {!forOther && (
          <div className="flex flex-col gap-1">
            <label htmlFor="loan-from" className="text-sm font-bold">Pay from</label>
            <select id="loan-from" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className={FIELD_CLASS}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
              {!wallets.length && <option value="">Any wallet</option>}
            </select>
          </div>
          )}
          {!forOther && !running && into && dateField("loan-date", "Received on", receivedOn, setReceivedOn)}
        </div>
        {!forOther && !running && into && isValidDate(receivedOn) && receivedOn < today && (
          <p className="rounded-2xl bg-sun-tint px-3.5 py-2.5 text-[13px] leading-snug">
            Received before today? If {wallets.find((w) => w.id === into)?.name}&apos;s balance here already includes it,
            or you&apos;ve spent it, adding it again counts it twice.{" "}
            <button type="button" onClick={() => pickMode("running")} className="font-extrabold text-sea-dark underline">
              Add it as an existing loan
            </button>
          </p>
        )}
        {running && datesOk && (
          <p className="text-[13px] leading-snug text-muted">
            {fullyPaid
              ? `All ${terms.months} due dates have passed. Paid off already? Then there's nothing to add.`
              : `${paidOverride === null ? "Counted from the due dates before today. " : ""}Next payment: ${paid + 1} of ${terms.months}, ${formatShortDay(nextDue, today)}.`}
          </p>
        )}
      </div>

      {summary && (
        <dl className="flex flex-col gap-1.5 rounded-[20px] bg-card px-4 py-3.5 text-[15px]">
          {running && (
            <>
              <div className="flex justify-between gap-3"><dt>Still to pay ({schedule.length} left)</dt><dd className="font-extrabold">{formatPeso(leftToPay)}</dd></div>
              <div className="flex justify-between gap-3"><dt>You owe {name || "the loan"} now</dt><dd className="font-extrabold">{formatPeso(owedNow)}</dd></div>
              <div className="mb-1 flex justify-between gap-3 border-b border-line-soft pb-2"><dt>Interest still ahead</dt><dd className="font-extrabold">{formatPeso(roundCents(leftToPay - owedNow))}</dd></div>
            </>
          )}
          <div className="flex justify-between gap-3"><dt>Total you&apos;ll pay</dt><dd className="font-extrabold">{formatPeso(summary.total)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Interest &amp; fees</dt><dd className="font-extrabold">{formatPeso(summary.interest)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Effective rate</dt><dd className="font-extrabold">{summary.ratePerMonth}% / month</dd></div>
        </dl>
      )}

      <p className="rounded-2xl bg-sun-tint px-4 py-3 text-sm leading-relaxed">
        {forOther ? (
          <>
            The money went to <strong>{who || "them"}</strong>, not your wallet, so they owe you what&apos;s still
            owed on it{valid ? ` (${formatPeso(owedNow)})` : ""}. They pay every payment, interest included
            {valid ? ` (${formatPeso(leftToPay)} in all)` : ""}: none of it is in your forecast or Safe to spend, and
            none of the interest is your expense. Tap <strong>They paid</strong> on the loan when they do.
          </>
        ) : running ? (
          <>
            You got this money before, so it&apos;s <strong>not added to any wallet</strong> and the {paid} payment
            {paid === 1 ? "" : "s"} you already made {paid === 1 ? "isn't" : "aren't"} logged again. {name || "The loan"}{" "}
            starts at what you still owe{valid ? ` (${formatPeso(owedNow)})` : ""}. Each payment from here: the
            principal part is a transfer, only the interest is an expense.
          </>
        ) : !into ? (
          <>
            <strong>Not added to any wallet</strong>, since it&apos;s already spent (even if you don&apos;t remember
            where). {name || "The loan"} starts at what you owe{valid ? ` (${formatPeso(owedNow)})` : ""}. Each
            payment: the principal part is a transfer, only the interest is an expense.
          </>
        ) : (
          <>
            The money you receive is <strong>not income</strong>. It&apos;s a transfer from {name || "the loan"}
            {into ? ` into ${wallets.find((w) => w.id === into)?.name}` : ""}, so your budget and savings stay
            honest. Each payment: the principal part is a transfer, only the interest is an expense.
          </>
        )}
      </p>

      {schedule.length > 0 && (
        <section aria-labelledby="loan-schedule" className="flex flex-col gap-1">
          <h2 id="loan-schedule" className="text-sm font-extrabold">{running ? "Payments left" : "Schedule preview"}</h2>
          <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1">
            {schedule.slice(0, 3).map((r) => (
              <li key={r.seq} className="flex justify-between border-b border-line-soft py-2 text-[15px] last:border-0">
                <span>{formatShortDay(r.dueOn, today)} · {r.seq} of {terms.months}</span>
                <span className="font-bold">{formatPeso(r.amount)}</span>
              </li>
            ))}
          </ul>
          {schedule.length > 3 && (
            <span className="text-[13px] text-muted">
              + {schedule.length - 3} more · {forOther ? `${who || "they"} pays these, not in your forecast` : "all added to your forecast"}
            </span>
          )}
        </section>
      )}

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <button type="submit" disabled={pending} className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink disabled:opacity-60">
        {pending ? "Saving…" : forOther ? `Add ${who ? `${who}'s` : "their"} loan` : "Add loan"}
      </button>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { lendFromCreditLine, lendOrBorrow } from "@/app/people-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import type { Account } from "@/lib/data";
import { addDays } from "@/lib/dates";
import { upcomingSchedule } from "@/lib/installments";
import { formatPeso, parseAmount, roundCents } from "@/lib/money";
import { nextOccurrence } from "@/lib/schedule";

export type LendCreditLine = {
  id: string;
  name: string;
  dueDay: number | null;
  /** What you owe on it that no plan covers yet. */
  unscheduled: number;
};

const MONTHS = [1, 2, 3, 4, 5, 6, 9, 12, 18, 24, 36];

/** The next due day on or after today, or a month from today. */
function nextDueOf(line: LendCreditLine | undefined, today: string): string {
  if (!line?.dueDay) return addDays(today, 30);
  return nextOccurrence({ frequency: "monthly", day1: line.dueDay, day2: null }, addDays(today, -1));
}

export function LendForm({
  wallets,
  creditLines,
  people,
  initialPerson,
  initialDirection,
  today,
}: {
  wallets: Account[];
  /** Someone used your Atome or SPayLater: lending from a credit line. */
  creditLines: LendCreditLine[];
  people: { id: string; name: string }[];
  /** A person id to start with, from their detail screen. */
  initialPerson: string | null;
  initialDirection: "lend" | "borrow";
  today: string;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState(initialDirection);
  const [personId, setPersonId] = useState<string | null>(
    people.some((p) => p.id === initialPerson) ? initialPerson : null,
  );
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [dueOn, setDueOn] = useState("");
  const [note, setNote] = useState("");
  const [count, setCount] = useState(false);
  // From a credit line: their installment.
  const [fee, setFee] = useState("");
  const [months, setMonths] = useState(3);
  const [alreadyPaid, setAlreadyPaid] = useState(0);
  const [nextDue, setNextDue] = useState("");
  const [owedChoice, setOwedChoice] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lend = direction === "lend";
  const line = lend ? creditLines.find((c) => c.id === walletId) : undefined;
  const each = parseAmount(amount);
  const feeValue = fee.trim() ? parseAmount(fee) : 0;
  const rows =
    line && each > 0 && feeValue >= 0 && feeValue < each && alreadyPaid < months
      ? upcomingSchedule({ amount: each, fee: feeValue, months, alreadyPaid }, nextDue || nextDueOf(line, today))
      : [];
  const left = roundCents(rows.reduce((sum, r) => sum + r.principalPart, 0));
  // Already in "You owe on it now" when what no plan covers yet is at least this much.
  const alreadyOwed = owedChoice ?? (line ? left > 0 && left <= line.unscheduled : false);

  // Typing a name that matches someone picks them.
  const typed = name.trim().toLowerCase();
  const matches = typed ? people.filter((p) => p.name.toLowerCase().includes(typed)) : people;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = parseAmount(amount);
    if (!(value > 0)) {
      setError("Enter an amount above ₱0.");
      return;
    }
    const exact = people.find((p) => p.name.toLowerCase() === typed);
    const who = personId ? { personId } : exact ? { personId: exact.id } : { name };
    if (!personId && !exact && !typed) {
      setError("Who is it? Pick someone or type a name.");
      return;
    }
    if (line) {
      if (Number.isNaN(feeValue) || feeValue >= value) {
        setError("The fee has to be less than each payment.");
        return;
      }
      startTransition(async () => {
        const result = await lendFromCreditLine({
          who,
          creditLineId: line.id,
          note,
          occurredOn: date,
          amount: value,
          fee: feeValue,
          months,
          alreadyPaid,
          nextDue: nextDue || nextDueOf(line, today),
          alreadyOwed,
        });
        if (result.error) setError(result.error);
        else router.push(`/money/people/${result.personId}`);
      });
      return;
    }
    startTransition(async () => {
      const result = await lendOrBorrow({
        direction,
        who,
        amount: value,
        walletId,
        occurredOn: date,
        dueOn: dueOn || null,
        countInForecast: count,
        note,
      });
      if (result.error) setError(result.error);
      else router.push(`/money/people/${result.personId}`);
    });
  }

  if (!wallets.length) {
    return <p className="rounded-[20px] bg-card p-5 text-muted">Add a wallet in Money first.</p>;
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div role="group" aria-label="Lent or borrowed" className="grid grid-cols-2 gap-1 rounded-2xl bg-card p-1">
        {(["lend", "borrow"] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={direction === d}
            onClick={() => setDirection(d)}
            className={`h-10 rounded-xl text-sm ${direction === d ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"}`}
          >
            {d === "lend" ? "I lent (pautang)" : "I borrowed (utang)"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="lend-who" className="text-sm font-bold">Who?</label>
        <input
          id="lend-who"
          value={personId ? (people.find((p) => p.id === personId)?.name ?? "") : name}
          onChange={(e) => {
            setPersonId(null);
            setName(e.target.value);
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
                  setName("");
                }}
                className={personId === p.id ? "" : "bg-card"}
              >
                {p.name}
              </ChoiceChip>
            ))}
          </div>
        )}
        {!personId && typed && !people.some((p) => p.name.toLowerCase() === typed) && (
          <span className="text-xs text-muted">I&apos;ll add {name.trim()} as someone new.</span>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <label htmlFor="lend-amount" className="text-[13px] font-bold text-muted">{line ? "EACH PAYMENT" : "AMOUNT"}</label>
        <AmountInput
          id="lend-amount"
          value={amount}
          onChange={setAmount}
          placeholder="₱ 0.00"
          className="w-full border-b-2 border-ink bg-transparent py-1 pl-11 text-center font-display text-4xl font-semibold outline-none focus:border-sea"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="lend-wallet" className="text-sm font-bold">{lend ? "Sent from" : "Received in"}</label>
            <select
              id="lend-wallet"
              value={walletId}
              onChange={(e) => {
                setWalletId(e.target.value);
                setNextDue("");
                setOwedChoice(null);
              }}
              className={FIELD_CLASS}
            >
              {lend && creditLines.length > 0 ? (
                <>
                  <optgroup label="My wallets">
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="They used my credit line">
                    {creditLines.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                </>
              ) : (
                wallets.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="lend-date" className="text-sm font-bold">{line ? "Bought on" : "Date"}</label>
            <input id="lend-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD_CLASS} />
          </div>
          {line && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="lend-months" className="text-sm font-bold">Payments</label>
                <select
                  id="lend-months"
                  value={months}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setMonths(m);
                    setAlreadyPaid((p) => Math.min(p, m - 1));
                  }}
                  className={FIELD_CLASS}
                >
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>{m === 1 ? "One payment" : `${m} months`}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="lend-paid" className="text-sm font-bold">Already paid</label>
                <select id="lend-paid" value={alreadyPaid} onChange={(e) => setAlreadyPaid(Number(e.target.value))} className={FIELD_CLASS}>
                  {Array.from({ length: months }, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? "None yet" : `${i} of ${months}`}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="lend-next" className="text-sm font-bold">Next payment due</label>
                <input
                  id="lend-next"
                  type="date"
                  value={nextDue || nextDueOf(line, today)}
                  onChange={(e) => setNextDue(e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="lend-fee" className="text-sm font-bold">
                  Fee in each <span className="font-semibold text-muted">(optional)</span>
                </label>
                <div className="relative">
                  <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
                  <AmountInput id="lend-fee" value={fee} onChange={setFee} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
                </div>
              </div>
            </>
          )}
          {!line && (
          <div className="flex flex-col gap-1">
            <label htmlFor="lend-due" className="text-sm font-bold">
              {lend ? "Promised to pay on" : "I'll pay back on"} <span className="font-semibold text-muted">(optional)</span>
            </label>
            <input id="lend-due" type="date" value={dueOn} min={date} onChange={(e) => setDueOn(e.target.value)} className={FIELD_CLASS} />
          </div>
          )}
          <div className={`flex flex-col gap-1 ${line ? "col-span-2" : ""}`}>
            <label htmlFor="lend-note" className="text-sm font-bold">{line ? "What they bought" : "Note"}</label>
            <input
              id="lend-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              placeholder={line ? "e.g. phone" : "e.g. tuition"}
              className={FIELD_CLASS}
            />
          </div>
        </div>
        {line ? (
          <>
            <label className="flex items-center justify-between gap-3 text-sm font-bold">
              It&apos;s already in what I owe on {line.name}
              <input
                type="checkbox"
                checked={alreadyOwed}
                onChange={(e) => setOwedChoice(e.target.checked)}
                className="h-6 w-6 shrink-0 accent-sea"
              />
            </label>
            {left > 0 && (
              <p className="rounded-[14px] bg-mint px-3 py-2.5 text-[13px] leading-snug">
                They&apos;ll owe you <strong>{formatPeso(left)}</strong>: {rows.length}{" "}
                {rows.length === 1 ? "payment" : "payments"} of {formatPeso(each)} left
                {feeValue > 0 && `, with the ${formatPeso(feeValue)} fee in each theirs too`}. What you owe on {line.name}{" "}
                {alreadyOwed ? "stays the same" : `goes up by ${formatPeso(left)}`}.
              </p>
            )}
          </>
        ) : lend ? (
          <label className="flex items-center justify-between gap-3 text-sm font-bold">
            Count it in my forecast on the due date
            <input type="checkbox" checked={count} disabled={!dueOn} onChange={(e) => setCount(e.target.checked)} className="h-6 w-6 shrink-0 accent-sea" />
          </label>
        ) : (
          <p className="text-xs text-muted">With a pay-back date, it shows in Coming up and your forecast like a bill.</p>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-muted">
        {line
          ? `Their payments go on ${line.name}'s bills marked as theirs, and never count in your forecast or Safe to spend. When they pay, tap They paid: their money goes straight to the bill, so your wallets don't move.`
          : lend
          ? "Off by default: I won't count on money until it's actually paid back. Lending isn't spending either; it's still your money."
          : "Borrowed money isn't income. It's a transfer from them, so your budget stays honest."}
      </p>

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <button type="submit" disabled={pending} className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink disabled:opacity-60">
        {pending
          ? "Saving…"
          : line
            ? `Lend ${left > 0 ? `${formatPeso(left)} ` : ""}on ${line.name}`
            : `${lend ? "Lend" : "Borrow"}${parseAmount(amount) > 0 ? ` ${formatPeso(parseAmount(amount))}` : ""}`}
      </button>
    </form>
  );
}

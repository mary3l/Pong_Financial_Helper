"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPlannedExpense } from "@/app/plan-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { ForecastChart } from "@/components/forecast-chart";
import { Pong, type PongMood } from "@/components/pong";
import { affordWithCredit, type BnplCap, type CreditOption, type CreditRoom } from "@/lib/bnpl";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { formatShortDay, isValidDate } from "@/lib/dates";
import { affordVerdict, splitAmount, type ForecastItem, type Verdict } from "@/lib/forecast";
import { MAX_AMOUNT, formatPeso, parseAmount } from "@/lib/money";
import type { Schedule } from "@/lib/schedule";

const MONTH_OPTIONS = [3, 6, 12];

const MOODS: Record<Verdict["tone"], PongMood> = {
  comfortable: "happy",
  tight: "worried",
  wait: "listen",
  no: "shocked",
};

export function AffordForm({
  start,
  items,
  today,
  nextPayday,
  payKnown,
  payday,
  credit,
  cap,
}: {
  /** Money in cash, bank and e-wallets now. */
  start: number;
  items: ForecastItem[];
  today: string;
  nextPayday: string | null;
  /** False when paydays add nothing because net pay isn't saved. */
  payKnown: boolean;
  payday: Schedule | null;
  /** BNPL lines, to show what using one would do when your own money falls short. */
  credit: CreditRoom[];
  /** Pong's monthly BNPL cap; null without credit lines. */
  cap: BnplCap | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [amountText, setAmountText] = useState("");
  const [when, setWhen] = useState(today);
  const [category, setCategory] = useState("shopping");
  const [months, setMonths] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = parseAmount(amountText);
  const valid = amount > 0 && amount <= MAX_AMOUNT && isValidDate(when) && when >= today;
  const purchase = { name: name.trim() || "This", amount, first: when, months };
  const verdict = valid ? affordVerdict({ start, items, purchase, today, nextPayday }) : null;
  // Only when your own money falls short or it's tight.
  const creditOptions =
    cap && verdict && verdict.tone !== "comfortable"
      ? affordWithCredit({ start, items, purchase, today, payday, lines: credit, cap })
      : [];
  const laterMonth = when.slice(0, 7) !== today.slice(0, 7);

  function save() {
    if (!valid) {
      setError(amountText.trim() ? "Check the amount and date." : "Enter an amount first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addPlannedExpense({ name, amount, category, first: when, months });
      if (result.error) setError(result.error);
      else router.push("/plan");
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6"
    >
      <div className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="afford-what" className="text-sm font-bold">What is it?</label>
          <input id="afford-what" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="e.g. running shoes" className={FIELD_CLASS} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1">
            <label htmlFor="afford-amount" className="text-sm font-bold">Amount</label>
            <div className="relative">
              <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
              <AmountInput
                id="afford-amount"
                value={amountText}
                onChange={setAmountText}
                placeholder="0.00"
                className={`${FIELD_CLASS} w-full pl-8`}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="afford-when" className="text-sm font-bold">{months > 1 ? "First payment" : "When"}</label>
            <input id="afford-when" type="date" value={when} min={today} required onChange={(e) => setWhen(e.target.value)} className={`${FIELD_CLASS} w-full px-3`} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="afford-category" className="text-sm font-bold">Category</label>
          <select id="afford-category" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD_CLASS}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1 text-sm font-bold">Pay as</legend>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-mint p-1">
            {[
              { label: "One-time", value: 1 },
              { label: "Installment", value: months > 1 ? months : 3 },
            ].map((o) => {
              const selected = o.value === 1 ? months === 1 : months > 1;
              return (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMonths(o.value)}
                  className={`h-10 rounded-xl text-sm ${selected ? "bg-card font-extrabold text-ink shadow-sm" : "font-bold text-muted"}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {months > 1 && (
            <div role="group" aria-label="Months" className="flex flex-wrap items-center gap-2 pt-1">
              {MONTH_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={months === m}
                  onClick={() => setMonths(m)}
                  className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${months === m ? "bg-ink text-mint" : "bg-mint text-ink"}`}
                >
                  {m} months
                </button>
              ))}
              {valid && (
                <span className="text-sm text-muted">
                  {formatPeso(splitAmount(amount, months)[0])} a month
                </span>
              )}
            </div>
          )}
        </fieldset>
      </div>

      <div className="flex flex-col gap-4">
        <section aria-live="polite" className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
          <h2 className="text-[13px] font-extrabold text-muted">RESULT</h2>
          {verdict ? (
            <Result verdict={verdict} today={today} onWait={setWhen} />
          ) : (
            <div className="flex items-center gap-2">
              <Pong mood="ask" size={64} decorative />
              <p className="text-[15px] text-muted">Type an amount and I&apos;ll check it against your forecast.</p>
            </div>
          )}
          {!payKnown && (
            <p className="text-[13px] text-muted">
              Paydays add nothing yet because your net pay isn&apos;t saved, so this errs on the careful side.
            </p>
          )}
        </section>

        {cap && creditOptions.length > 0 && (
          <WithCredit options={creditOptions} cap={cap} laterMonth={laterMonth} today={today} />
        )}

        <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={pending} className="h-[52px] rounded-[18px] bg-sun font-extrabold text-ink disabled:opacity-60">
            {pending ? "Saving…" : "Add as planned expense"}
          </button>
          <Link href="/plan" className="flex h-11 items-center justify-center font-extrabold text-sea-dark">
            Just checking, discard
          </Link>
        </div>
      </div>
    </form>
  );
}

function Result({
  verdict,
  today,
  onWait,
}: {
  verdict: Verdict;
  today: string;
  onWait: (date: string) => void;
}) {
  const { before, after } = verdict;
  const title = verdict.waitUntil ? `Wait until ${formatShortDay(verdict.waitUntil, today)}` : verdict.title;
  return (
    <>
      <div className="flex items-center gap-2">
        <Pong mood={MOODS[verdict.tone]} size={64} decorative />
        <p className={`font-display text-2xl font-semibold ${verdict.tone === "no" ? "text-coral-text" : ""}`}>{title}</p>
      </div>
      <ForecastChart
        days={before.days}
        compare={after.days}
        low={after.lowest}
        height={90}
        label={`Forecast before and after this purchase. Lowest point goes from ${formatPeso(before.lowest.balance)} to ${formatPeso(after.lowest.balance)}.`}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-sea" />Before</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2 border-dashed border-coral" />After buying</span>
      </div>
      <dl className="flex flex-col gap-1 text-[15px]">
        <div className="flex justify-between gap-3">
          <dt>Lowest point before</dt>
          <dd className="font-bold">{formatPeso(before.lowest.balance)} on {formatShortDay(before.lowest.date, today)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Lowest point after</dt>
          <dd className={`font-extrabold ${after.lowest.balance < 0 ? "text-coral-text" : ""}`}>
            {formatPeso(after.lowest.balance)} on {formatShortDay(after.lowest.date, today)}
          </dd>
        </div>
      </dl>
      {verdict.waitUntil && (
        <button
          type="button"
          onClick={() => onWait(verdict.waitUntil!)}
          className="h-11 self-start rounded-[14px] border-2 border-line px-4 font-extrabold text-ink hover:bg-mint"
        >
          Plan it for {formatShortDay(verdict.waitUntil, today)}
        </button>
      )}
      {verdict.tone === "no" && before.lowest.balance < 0 && (
        <p className="text-[13px] text-muted">Your forecast already dips below ₱0 without this.</p>
      )}
    </>
  );
}

/** The same purchase on each BNPL line, paid back on its due days from your own money. */
function WithCredit({
  options,
  cap,
  laterMonth,
  today,
}: {
  options: CreditOption[];
  cap: BnplCap;
  /** Buying in a later month: that month's cap starts over. */
  laterMonth: boolean;
  today: string;
}) {
  return (
    <section aria-live="polite" className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13px] font-extrabold text-muted">WITH BNPL · BORROWED</h2>
        <p className="text-[13px] text-muted">
          You pay it back from your own money on each due day.
          {cap.status === "set" &&
            (laterMonth
              ? ` My cap that month: about ${formatPeso(cap.cap!)}, worked out again from your records.`
              : ` My cap this month: ${formatPeso(cap.cap!)}, ${formatPeso(cap.left!)} left.`)}
        </p>
      </div>
      {cap.status === "paused" ? (
        <div className="flex items-center gap-2">
          <Pong mood="worried" size={48} decorative />
          <p className="text-[15px]">
            <span className="font-extrabold">BNPL is paused.</span> {cap.reason}
          </p>
        </div>
      ) : (
      <ul className="flex flex-col divide-y divide-line">
        {options.map((o) => (
          <li key={o.line.id} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
            {o.verdict ? (
              <>
                <p className={`font-extrabold ${o.verdict.tone === "no" ? "text-coral-text" : ""}`}>
                  {o.line.name}: {o.verdict.title}
                </p>
                <p className="text-[15px]">
                  {o.months > 1
                    ? `${formatPeso(o.payment)} × ${o.months} months, first due ${formatShortDay(o.firstDue, today)}`
                    : `${formatPeso(o.payment)} due ${formatShortDay(o.firstDue, today)}`}
                </p>
                {o.perDay !== null && o.cycle && (
                  <p className="text-[13px] text-muted">
                    {o.months > 1 ? "Each payment leaves" : "Leaves"} about {formatPeso(o.perDay)} less a day
                    from payday on {formatShortDay(o.cycle.from, today)} until {formatShortDay(o.cycle.until, today)}.
                  </p>
                )}
                {o.verdict.tone === "no" && (
                  <p className="text-[13px] text-muted">
                    Lowest point after: {formatPeso(o.verdict.after.lowest.balance)} on{" "}
                    {formatShortDay(o.verdict.after.lowest.date, today)}.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[15px] text-muted">
                <span className="font-extrabold">{o.line.name}:</span>{" "}
                {o.capped
                  ? `over my cap. Only ${formatPeso(o.room)} more ${laterMonth ? "that" : "this"} month`
                  : `only ${formatPeso(o.room)} left on it`}
              </p>
            )}
          </li>
        ))}
      </ul>
      )}
      <p className="text-[13px] text-muted">Any fee or interest the app charges isn&apos;t included.</p>
    </section>
  );
}

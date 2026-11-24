"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPlannedExpense } from "@/app/plan-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { CloseIcon } from "@/components/icons";
import { ForecastChart } from "@/components/forecast-chart";
import { Pong, type PongMood } from "@/components/pong";
import { affordWithCredit, type BnplCap, type CreditOption, type CreditRoom } from "@/lib/bnpl";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { formatShortDay, isValidDate } from "@/lib/dates";
import { splitAmount, walletCheck, type ForecastItem, type WalletCheck } from "@/lib/forecast";
import { MAX_AMOUNT, formatPeso, parseAmount } from "@/lib/money";
import { PLAN_FLOOR, affordVerdict, type Verdict } from "@/lib/payment-plan";
import type { Schedule } from "@/lib/schedule";

const MONTH_OPTIONS = [3, 6, 12];

const MOODS: Record<Verdict["tone"], PongMood> = {
  comfortable: "happy",
  tight: "worried",
  wait: "listen",
  no: "shocked",
};

/** What "one-time" means on each: a card's straight bill, BNPL's pay next month. */
function oneTimeLabel(line: CreditRoom | undefined): string {
  if (!line) return "One-time";
  return line.kind === "card" ? "Straight" : "Pay next month";
}

export function AffordForm({
  mode,
  start,
  items,
  today,
  nextPayday,
  payKnown,
  payday,
  credit,
  cap,
  wallets,
}: {
  /** "modal": over the page you were on, closing with back. "page": /afford opened directly. */
  mode: "modal" | "page";
  /** Money in cash, bank and e-wallets now. */
  start: number;
  items: ForecastItem[];
  today: string;
  nextPayday: string | null;
  /** False when paydays add nothing because net pay isn't saved. */
  payKnown: boolean;
  payday: Schedule | null;
  /** Credit cards and BNPL lines, to pay with: the forecast then has their bills on their due days. */
  credit: CreditRoom[];
  /** Pong's monthly BNPL cap; null without credit lines. */
  cap: BnplCap | null;
  /** Cash, bank and e-wallets for spending, to pay it from. */
  wallets: { id: string; name: string; balance: number }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [amountText, setAmountText] = useState("");
  const [when, setWhen] = useState(today);
  const [category, setCategory] = useState("shopping");
  const [months, setMonths] = useState(1);
  // "" is any wallet: the check is on all your spending money together.
  // A card or BNPL line's id pays with it: its bills go on the forecast.
  const [payWith, setPayWith] = useState("");
  const [rateText, setRateText] = useState("0");
  const wallet = wallets.find((w) => w.id === payWith) ?? null;
  const line = credit.find((l) => l.id === payWith);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = parseAmount(amountText);
  const valid = amount > 0 && amount <= MAX_AMOUNT && isValidDate(when) && when >= today;
  const purchase = { name: name.trim() || "This", amount, first: when, months };
  // A card paid straight has no fee; BNPL's pay next month and any installment can.
  const showFee = Boolean(line) && (months > 1 || line?.kind === "bnpl");
  const rate = showFee ? Number(rateText.trim() || "0") : 0;
  const rateOk = rate >= 0 && rate <= 10;
  const laterMonth = when.slice(0, 7) !== today.slice(0, 7);

  // Your own money: wallets, together or the one picked.
  const verdict =
    valid && !line ? affordVerdict({ start, items, purchase, today, nextPayday }) : null;
  const inWallet =
    valid && wallet
      ? walletCheck({ balance: wallet.balance, walletId: wallet.id, items, purchase, today })
      : null;
  // On the card or BNPL picked: its bills on its due days.
  const chosen =
    valid && line && rateOk
      ? affordWithCredit({
          start,
          items,
          purchase,
          today,
          payday,
          lines: [line],
          cap,
          ratePerMonth: rate,
        })[0]
      : null;
  // From your own money and it's tight or doesn't fit: what each line would do.
  const suggestions =
    verdict && verdict.tone !== "comfortable" && credit.length
      ? affordWithCredit({ start, items, purchase, today, payday, lines: credit, cap })
      : [];

  function pickPayWith(id: string) {
    setPayWith(id);
    setError(null);
    const picked = credit.find((l) => l.id === id);
    // A card goes on its statement in full; BNPL starts at 3 months, like Add.
    if (picked && months === 1 && picked.kind === "bnpl") setMonths(3);
  }

  function save() {
    if (!valid) {
      setError(amountText.trim() ? "Check the amount and date." : "Enter an amount first.");
      return;
    }
    if (line && !rateOk) {
      setError("Check the monthly fee (0 to 10%).");
      return;
    }
    if (line && chosen && !chosen.fits) {
      setError(`That's more than you can put on ${line.name}.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addPlannedExpense({
        name,
        amount,
        category,
        first: when,
        months,
        accountId: wallet?.id ?? null,
        credit: line ? { lineId: line.id, ratePerMonth: rate } : null,
      });
      if (result.error) setError(result.error);
      // Scheduled is where it can be changed or removed.
      else router.push(`/plan/scheduled?added=${months > 1 ? months : 1}`);
    });
  }

  function close() {
    if (mode === "modal") router.back();
    else router.push("/");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className={`flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 ${
        mode === "modal" ? "px-5 pt-3 pb-6 lg:p-7" : ""
      }`}
    >
      {mode === "modal" && (
        <div className="flex items-start justify-between gap-3 lg:col-span-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="font-display text-2xl font-semibold">Can I afford this?</h1>
            <p className="text-[15px] text-muted">
              Test a purchase against your forecast before you spend.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card"
          >
            <CloseIcon size={18} />
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="afford-what" className="text-sm font-bold">
            What is it?
          </label>
          <input
            id="afford-what"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder="e.g. running shoes"
            className={FIELD_CLASS}
          />
        </div>
        {/* Side by side only when there's room: a phone gets the full date. */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 min-[420px]:gap-2.5">
          <div className="flex flex-col gap-1">
            <label htmlFor="afford-amount" className="text-sm font-bold">
              Amount
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted"
              >
                ₱
              </span>
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
            <label htmlFor="afford-when" className="text-sm font-bold">
              {line ? "Buy on" : months > 1 ? "First payment" : "When"}
            </label>
            <input
              id="afford-when"
              type="date"
              value={when}
              min={today}
              required
              onChange={(e) => setWhen(e.target.value)}
              className={`${FIELD_CLASS} w-full px-3`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="afford-category" className="text-sm font-bold">
            Category
          </label>
          <select
            id="afford-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={FIELD_CLASS}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {(wallets.length > 0 || credit.length > 0) && (
          <div className="flex flex-col gap-1.5">
            <span id="afford-pay-label" className="text-sm font-bold">
              Pay with
            </span>
            <div role="group" aria-labelledby="afford-pay-label" className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                {credit.length > 0 && (
                  <span className="text-[11px] font-extrabold tracking-wide text-muted uppercase">
                    My wallets
                  </span>
                )}
                <div className="flex flex-wrap gap-2">
                  <PayChip selected={payWith === ""} onClick={() => pickPayWith("")}>
                    Any wallet
                  </PayChip>
                  {wallets.map((w) => (
                    <PayChip
                      key={w.id}
                      selected={payWith === w.id}
                      onClick={() => pickPayWith(w.id)}
                    >
                      {w.name}
                      <span className="font-semibold opacity-70"> · {formatPeso(w.balance)}</span>
                    </PayChip>
                  ))}
                </div>
              </div>
              {credit.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-extrabold tracking-wide text-muted uppercase">
                    Cards &amp; BNPL
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {credit.map((l) => (
                      <PayChip
                        key={l.id}
                        selected={payWith === l.id}
                        onClick={() => pickPayWith(l.id)}
                      >
                        {l.name}
                      </PayChip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1 text-sm font-bold">Pay as</legend>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-mint p-1">
            {[
              { label: oneTimeLabel(line), value: 1 },
              { label: "Installment", value: months > 1 ? months : 3 },
            ].map((o) => {
              const selected = o.value === 1 ? months === 1 : months > 1;
              return (
                <button
                  key={o.value === 1 ? "one" : "installment"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMonths(o.value)}
                  className={`h-10 rounded-xl text-sm ${selected ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {months > 1 && (
            <div
              role="group"
              aria-label="Months"
              className="flex flex-wrap items-center gap-2 pt-1"
            >
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
                  {formatPeso(chosen ? chosen.payment : splitAmount(amount, months)[0])} a month
                </span>
              )}
            </div>
          )}
          {showFee && (
            <div className="flex items-center gap-2 pt-1">
              <label htmlFor="afford-rate" className="text-sm font-bold">
                Fee % / mo
              </label>
              <input
                id="afford-rate"
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
                inputMode="decimal"
                className={`${FIELD_CLASS} h-10 w-20 px-3 text-right`}
              />
              <span className="text-[13px] text-muted">
                {rateOk ? "As the app shows it. 0 for none." : "0 to 10%"}
              </span>
            </div>
          )}
        </fieldset>
      </div>

      <div className="flex flex-col gap-4">
        <section aria-live="polite" className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
          <h2 className="text-[13px] font-extrabold text-muted">
            {line ? `RESULT · ON ${line.name.toUpperCase()}` : "RESULT"}
          </h2>
          {chosen ? (
            <CreditResult option={chosen} cap={cap} laterMonth={laterMonth} today={today} />
          ) : verdict ? (
            <>
              <Result verdict={verdict} today={today} onWait={setWhen} />
              {wallet && inWallet && (
                <InWallet
                  name={wallet.name}
                  check={inWallet}
                  installments={months > 1}
                  today={today}
                />
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Pong mood="ask" size={64} decorative />
              <p className="text-[15px] text-muted">
                {line && valid && !rateOk
                  ? "Check the monthly fee: 0 to 10%."
                  : "Type an amount and I'll check it against your forecast."}
              </p>
            </div>
          )}
          {!payKnown && (
            <p className="text-[13px] text-muted">
              Paydays add nothing yet because your net pay isn&apos;t saved, so this errs on the
              careful side.
            </p>
          )}
        </section>

        {suggestions.length > 0 && (
          <OnCredit
            options={suggestions}
            cap={cap}
            laterMonth={laterMonth}
            today={today}
            onPick={pickPayWith}
          />
        )}

        <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
          {error}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-[52px] rounded-[18px] bg-sun font-extrabold text-ink disabled:opacity-60"
          >
            {pending
              ? "Saving…"
              : line
                ? `Add ${line.name}'s ${months > 1 ? "payments" : "bill"} to my plan`
                : "Add as planned expense"}
          </button>
          <button
            type="button"
            onClick={close}
            className="flex h-11 items-center justify-center font-extrabold text-sea-dark"
          >
            Just checking, discard
          </button>
          <p className="text-center text-[13px] text-muted">
            {line
              ? "They go in Plan › Scheduled on its due days, so your forecast counts them. When you buy it, log it in Add on the card and remove these."
              : "Got it wrong later? Change or remove it any time in Plan › Scheduled."}
          </p>
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
  const title = verdict.waitUntil
    ? `Wait until ${formatShortDay(verdict.waitUntil, today)}`
    : verdict.title;
  return (
    <>
      <div className="flex items-center gap-2">
        <Pong mood={MOODS[verdict.tone]} size={64} decorative />
        <p
          className={`font-display text-2xl font-semibold ${verdict.tone === "no" ? "text-coral-text" : ""}`}
        >
          {title}
        </p>
      </div>
      <ForecastChart
        days={before.days}
        compare={after.days}
        low={after.lowest}
        height={90}
        label={`Your wallets spending ${formatPeso(verdict.perDayBefore)} a day, before and after this purchase. Lowest point goes from ${formatPeso(before.lowest.balance)} to ${formatPeso(after.lowest.balance)}.`}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 bg-sea" />
          Before
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-coral" />
          After buying
        </span>
      </div>
      <dl className="flex flex-col gap-1 text-[15px]">
        <div className="flex justify-between gap-3">
          <dt>Daily amount</dt>
          <dd className="font-bold">
            {verdict.biggestCut
              ? `${formatPeso(verdict.biggestCut.before)} → ${formatPeso(verdict.biggestCut.after)}${
                  verdict.biggestCut.from === today
                    ? ""
                    : ` from ${formatShortDay(verdict.biggestCut.from, today)}`
                }`
              : `${formatPeso(verdict.perDayBefore)}, no change`}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Lowest point before</dt>
          <dd className="font-bold">
            {formatPeso(before.lowest.balance)} on {formatShortDay(before.lowest.date, today)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Lowest point after, same daily amount</dt>
          <dd
            className={`font-extrabold ${after.lowest.balance < PLAN_FLOOR ? "text-coral-text" : ""}`}
          >
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
      {verdict.tone === "no" && verdict.alreadyShort && (
        <p className="text-[13px] text-muted">
          Even without this, your plan can&apos;t keep {formatPeso(PLAN_FLOOR)} in your wallets.
        </p>
      )}
    </>
  );
}

/** Whether the wallet you picked has enough on the day: the forecast above counts all your spending money. */
function InWallet({
  name,
  check,
  installments,
  today,
}: {
  name: string;
  check: WalletCheck;
  installments: boolean;
  today: string;
}) {
  const when = check.date === today ? "now" : `on ${formatShortDay(check.date, today)}`;
  if (check.after < 0) {
    return (
      <p className="rounded-[14px] bg-coral-tint px-3 py-2 text-[15px]">
        <strong className="text-coral-text">Not enough in {name}</strong>: about{" "}
        {formatPeso(check.before)} there {when}
        {installments ? " for that payment" : ""}. Move {formatPeso(-check.after)} in first, or pay
        from another wallet.
      </p>
    );
  }
  return (
    <p className="rounded-[14px] bg-sea-tint px-3 py-2 text-[15px]">
      <strong>{name}</strong>: about {formatPeso(check.before)} {when}, {formatPeso(check.after)}{" "}
      after paying
      {installments ? " (its tightest payment)" : ""}.
    </p>
  );
}

/** "₱1,000 × 3 months, first due Dec 5" or "₱3,000 due Dec 20". */
function paymentsText(o: CreditOption, today: string): string {
  return o.months > 1
    ? `${formatPeso(o.payment)} × ${o.months} months, first due ${formatShortDay(o.firstDue, today)}`
    : `${formatPeso(o.payment)} due ${formatShortDay(o.firstDue, today)}`;
}

/** Why a line can't take it: Pong's cap, or what's left of its limit. */
function overText(o: CreditOption, laterMonth: boolean): string {
  const room = formatPeso(o.room ?? 0);
  return o.capped
    ? `Over my cap. Only ${room} more ${laterMonth ? "that" : "this"} month`
    : `Only ${room} left on it`;
}

/** What Pong's cap says about a purchase on this line. Null when there's nothing to say. */
function capText(o: CreditOption, cap: BnplCap | null, laterMonth: boolean): string | null {
  if (!o.counted) return "A card paid straight doesn't use my BNPL cap. Just pay the full bill.";
  if (!cap || cap.status !== "set") return null;
  return laterMonth
    ? `My cap that month: about ${formatPeso(cap.cap!)}, worked out again from your records.`
    : `My cap this month: ${formatPeso(cap.cap!)}, ${formatPeso(cap.left!)} left.`;
}

/** The result on the card or BNPL you picked: the forecast with its bills, fees included. */
function CreditResult({
  option: o,
  cap,
  laterMonth,
  today,
}: {
  option: CreditOption;
  cap: BnplCap | null;
  laterMonth: boolean;
  today: string;
}) {
  const paused = o.counted && cap?.status === "paused";
  if (!o.verdict) {
    return (
      <div className="flex items-center gap-2">
        <Pong mood={paused ? "worried" : "shocked"} size={64} decorative />
        <div className="flex flex-col gap-0.5">
          <p className="font-display text-2xl font-semibold text-coral-text">
            {paused ? "BNPL is paused" : `Not on ${o.line.name}`}
          </p>
          <p className="text-[15px]">{paused ? cap!.reason : `${overText(o, laterMonth)}.`}</p>
        </div>
      </div>
    );
  }
  const cycleText =
    o.perDay !== null && o.cycle
      ? `${o.months > 1 ? "Each payment leaves" : "It leaves"} about ${formatPeso(o.perDay)} less a day from payday on ${formatShortDay(o.cycle.from, today)} until ${formatShortDay(o.cycle.until, today)}.`
      : null;
  const capLine = capText(o, cap, laterMonth);
  return (
    <>
      <Result verdict={o.verdict} today={today} onWait={() => {}} />
      <dl className="flex flex-col gap-1 border-t border-line-soft pt-2 text-[15px]">
        <div className="flex justify-between gap-3">
          <dt>{o.months > 1 ? "Payments" : "Bill"}</dt>
          <dd className="text-right font-bold">{paymentsText(o, today)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Fees &amp; interest</dt>
          <dd className="font-bold">{o.fees > 0 ? `${formatPeso(o.fees)} in all` : "None"}</dd>
        </div>
      </dl>
      {cycleText && <p className="text-[13px] text-muted">{cycleText}</p>}
      {capLine && <p className="text-[13px] text-muted">{capLine}</p>}
    </>
  );
}

/** Your own money is tight: what each card or BNPL line would do, paid back on its due days. */
function OnCredit({
  options,
  cap,
  laterMonth,
  today,
  onPick,
}: {
  options: CreditOption[];
  cap: BnplCap | null;
  /** Buying in a later month: that month's cap starts over. */
  laterMonth: boolean;
  today: string;
  onPick: (lineId: string) => void;
}) {
  return (
    <section aria-live="polite" className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13px] font-extrabold text-muted">OR ON A CARD OR BNPL · BORROWED</h2>
        <p className="text-[13px] text-muted">
          You pay it back from your own money on each due day. Pick one to see its forecast and add
          its fee.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {options.map((o) => {
          const paused = o.counted && cap?.status === "paused";
          return (
            <li
              key={o.line.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                {o.verdict ? (
                  <>
                    <p
                      className={`font-extrabold ${o.verdict.tone === "no" ? "text-coral-text" : ""}`}
                    >
                      {o.line.name}: {o.verdict.title}
                    </p>
                    <p className="text-[15px]">{paymentsText(o, today)}</p>
                  </>
                ) : (
                  <p className="text-[15px] text-muted">
                    <span className="font-extrabold">{o.line.name}:</span>{" "}
                    {paused ? "BNPL is paused" : overText(o, laterMonth)}
                  </p>
                )}
              </div>
              {o.verdict && (
                <button
                  type="button"
                  onClick={() => onPick(o.line.id)}
                  className="h-10 shrink-0 rounded-[14px] border-2 border-line px-3 text-sm font-extrabold hover:bg-mint"
                >
                  Use it
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {cap?.status === "paused" && (
        <p className="text-[13px] text-muted">BNPL is paused: {cap.reason}</p>
      )}
    </section>
  );
}

/** A Pay with choice: mint on the white card, ink once picked. */
function PayChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-10 shrink-0 rounded-full px-4 text-sm font-extrabold ${
        selected ? "bg-ink text-mint" : "bg-mint text-ink hover:bg-sea-tint"
      }`}
    >
      {children}
    </button>
  );
}

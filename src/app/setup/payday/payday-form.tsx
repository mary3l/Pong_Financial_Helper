"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { finishSetup, savePaydayAndBills, type BillInput } from "@/app/setup-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { PaydayPicker, choiceFrom, dayLabel, ordinal, scheduleFrom, type PayKind } from "@/components/payday-picker";
import type { Account, RecurringItem } from "@/lib/data";
import { formatPeso, parseAmount, roundCents } from "@/lib/money";
import { WEEKDAYS, WEEKS_OF_MONTH, describeSchedule, hasOwnAmounts, payPerMonth, slotCount, type Frequency } from "@/lib/schedule";

const PAY_KINDS: PayKind[] = ["daily", "weekly", "twice_monthly", "monthly", "irregular"];

const BILL_IDEAS = ["Rent", "Electricity", "Water", "Internet", "Phone plan", "Subscriptions"];

type BillRow = { key: number; id?: string; name: string; amount: string; day: number; accountId: string };

let nextKey = 0;

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Each payday's own amount as typed, from what's saved for this kind of pay. */
function slotTexts(payday: RecurringItem | null, frequency: Frequency): string[] {
  const saved = payday?.frequency === frequency ? payday.amounts : null;
  return Array.from({ length: slotCount(frequency) }, (_, i) => (saved?.[i] != null ? String(saved[i]) : ""));
}

export function PaydayForm({
  accounts,
  payday,
  bills,
  editing,
  payroll,
}: {
  accounts: Account[];
  payday: RecurringItem | null;
  bills: RecurringItem[];
  /** True when opened from Settings rather than first-run setup. */
  editing: boolean;
  /**
   * The payroll calculator works out each payday, and sets how you're paid:
   * what each pay covers, in words ("cutoffs 3–17 and 18–2"). Null when it
   * isn't set up.
   */
  payroll: { cutoffs: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [choice, setChoice] = useState(() => choiceFrom(payday, editing ? "irregular" : "twice_monthly"));
  const kind = choice.kind;
  const [netPay, setNetPay] = useState(payday?.amount ? String(payday.amount) : "");
  // Not every payday is the same: an amount per week, or per payday twice a month.
  const [perPayday, setPerPayday] = useState(Boolean(payday && hasOwnAmounts(payday)));
  const [weekAmounts, setWeekAmounts] = useState(() => slotTexts(payday, "weekly"));
  const [dayAmounts, setDayAmounts] = useState(() => slotTexts(payday, "twice_monthly"));
  const defaultWallet = accounts.find((a) => a.type === "bank")?.id ?? accounts[0]?.id ?? "";
  const [payAccount, setPayAccount] = useState(payday?.accountId ?? defaultWallet);
  const [rows, setRows] = useState<BillRow[]>(() =>
    bills.map((b) => ({
      key: nextKey++,
      id: b.id,
      name: b.name,
      amount: b.amount ? String(b.amount) : "",
      day: b.day1,
      accountId: b.accountId ?? "",
    })),
  );
  // With the calculator, how you're paid is set there: this keeps what's saved.
  const fromPayroll = Boolean(payroll && payday);
  const ownAmountsKind = kind === "weekly" || kind === "twice_monthly";

  const update = (key: number, patch: Partial<BillRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addBill = (name = "") =>
    setRows((rs) => [...rs, { key: nextKey++, name, amount: "", day: 1, accountId: "" }]);

  const unusedIdeas = BILL_IDEAS.filter(
    (idea) => !rows.some((r) => r.name.trim().toLowerCase() === idea.toLowerCase()),
  );

  function done() {
    router.push(editing ? "/settings" : "/");
  }

  function save() {
    setError(null);

    const picked = fromPayroll ? { schedule: payday!, order: [0, 1] as const } : scheduleFrom(choice);
    if ("error" in picked && picked.error) {
      setError(picked.error);
      return;
    }
    const schedule = picked.schedule
      ? {
          frequency: picked.schedule.frequency,
          day1: picked.schedule.day1,
          day2: picked.schedule.day2,
          weeks: picked.schedule.weeks ?? null,
          weekdays: picked.schedule.weekdays ?? null,
        }
      : null;
    // Each payday's amount as typed, in the schedule's order.
    let typed: { label: string; text: string }[] = [];
    if (schedule?.frequency === "twice_monthly" && !fromPayroll) {
      typed = picked.order.map((i) => ({ label: `the ${ordinal(choice.twice[i])}`, text: dayAmounts[i] }));
    } else if (schedule?.frequency === "weekly" && !fromPayroll) {
      const paying = schedule.weeks ?? WEEKS_OF_MONTH;
      // Only the weeks that pay keep an amount.
      typed = WEEKS_OF_MONTH.map((w, i) => ({ label: `week ${w}`, text: paying.includes(w) ? weekAmounts[i] : "" }));
    }

    let amount: number | null = null;
    let amounts: (number | null)[] | null = null;
    if (schedule && perPayday && !payroll && typed.length > 0) {
      const values: (number | null)[] = [];
      for (const { label, text } of typed) {
        const value = text.trim() ? parseAmount(text) : null;
        if (value !== null && !(value > 0)) {
          setError(`Check the pay for ${label}, or leave it blank.`);
          return;
        }
        values.push(value);
      }
      const known = values.filter((a): a is number => a !== null);
      if (known.length) {
        amounts = values;
        // A typical payday, for anywhere that shows one amount; blanks use it too.
        amount = roundCents(known.reduce((s, a) => s + a, 0) / known.length);
      }
    } else if (schedule && netPay.trim()) {
      amount = parseAmount(netPay);
      if (!(amount > 0)) {
        setError("Check your net pay, or leave it blank.");
        return;
      }
    }

    const billInputs: BillInput[] = [];
    for (const row of rows) {
      const name = row.name.trim();
      if (!name && !row.amount.trim()) continue;
      const billAmount = parseAmount(row.amount);
      if (!name) {
        setError("Give each bill a name.");
        return;
      }
      if (!(billAmount > 0)) {
        setError(`Add an amount for ${name}. A guess is fine.`);
        return;
      }
      billInputs.push({ id: row.id, name, amount: billAmount, day: row.day, accountId: row.accountId || null });
    }

    startTransition(async () => {
      const result = await savePaydayAndBills({
        schedule: schedule ? { ...schedule, amounts } : null,
        amount,
        // Keep "estimate" while the amount is the one the calculator saved.
        amountVaries: Boolean(payday?.amountVaries) && amount === payday?.amount,
        accountId: schedule ? payAccount || null : null,
        bills: billInputs,
      });
      if (result.error) setError(result.error);
      else done();
    });
  }

  function skip() {
    setError(null);
    startTransition(async () => {
      const result = await finishSetup();
      if (result.error) setError(result.error);
      else done();
    });
  }

  const daySelect = (id: string, value: number, onChange: (v: number) => void, label: string) => (
    <div className="flex flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className={FIELD_CLASS}>
        {DAYS.map((d) => (
          <option key={d} value={d}>{dayLabel(d)}</option>
        ))}
      </select>
    </div>
  );

  return (
    // Two columns only where there's room (Settings on a computer): your
    // payday and the buttons on the left, staying in view, bills on the right.
    // The first-run setup column and phones stay one column, buttons last.
    <div className="@container flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-6 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @3xl:items-start">
        <div className="contents @3xl:sticky @3xl:top-6 @3xl:flex @3xl:flex-col @3xl:gap-4">
          <section className="flex flex-col gap-4 rounded-3xl bg-card p-5">
            <h2 id="pay-kind" className="font-display text-xl font-semibold">How do you get paid?</h2>
            {fromPayroll ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[15px] font-bold">
                  {describeSchedule(payday!)} · {payroll!.cutoffs}
                </p>
                <p className="text-sm text-muted">Worked out by the payroll calculator, payday by payday.</p>
                <Link href="/payroll" className="text-sm font-extrabold text-sea-dark hover:underline">
                  Change in Payroll calculator ›
                </Link>
              </div>
            ) : (
              <PaydayPicker value={choice} onChange={setChoice} kinds={PAY_KINDS} idPrefix="payday" labelledBy="pay-kind" />
            )}
            {kind === "irregular" && !fromPayroll ? (
              <p className="text-sm leading-relaxed text-muted">
                No problem. Log income when it comes in. Safe to spend needs a payday, so it
                will show your wallet total instead.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {!payroll && (
                  <div className="flex flex-1 flex-col gap-2">
                    {ownAmountsKind && (
                      <div role="group" aria-label="Pay per payday" className="grid grid-cols-2 gap-1 rounded-xl bg-mint p-1">
                        {[false, true].map((own) => (
                          <button
                            key={String(own)}
                            type="button"
                            aria-pressed={perPayday === own}
                            onClick={() => setPerPayday(own)}
                            className={`h-9 rounded-lg text-sm ${perPayday === own ? "bg-card font-extrabold" : "font-bold text-muted"}`}
                          >
                            {own ? (kind === "weekly" ? "Different each week" : "Different each payday") : "Same every payday"}
                          </button>
                        ))}
                      </div>
                    )}
                    {perPayday && ownAmountsKind ? (
                      <PerPaydayAmounts
                        rows={
                          kind === "weekly"
                            ? [...choice.weeks].sort((a, b) => a - b).map((w) => ({
                                key: w - 1,
                                label: `Week ${w}`,
                                hint: `${ordinal(w)} ${WEEKDAYS[choice.weekday]}`,
                              }))
                            : [0, 1].map((i) => ({ key: i, label: `${i === 0 ? "First" : "Second"} payday`, hint: dayLabel(choice.twice[i]) }))
                        }
                        values={kind === "weekly" ? weekAmounts : dayAmounts}
                        onChange={(i, v) => (kind === "weekly" ? setWeekAmounts : setDayAmounts)((xs) => xs.map((x, j) => (j === i ? v : x)))}
                        perMonth={monthlyFromTexts(kind as Frequency, choice.weeks, kind === "weekly" ? weekAmounts : dayAmounts)}
                      />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <label htmlFor="net-pay" className="text-sm font-bold">
                          {kind === "daily" ? "Pay each payday" : "Net pay per payday"} <span className="font-semibold text-muted">(optional)</span>
                        </label>
                        <div className="relative">
                          <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
                          <AmountInput id="net-pay" value={netPay} onChange={setNetPay} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8`} />
                        </div>
                      </div>
                    )}
                    {editing && (
                      <Link href="/payroll" className="text-sm font-extrabold text-sea-dark hover:underline">
                        Paid by the day you work? Use the payroll calculator
                      </Link>
                    )}
                  </div>
                )}
                {accounts.length > 0 && (
                  <div className="flex flex-1 flex-col gap-1">
                    <label htmlFor="pay-account" className="text-sm font-bold">Goes to</label>
                    <select id="pay-account" value={payAccount} onChange={(e) => setPayAccount(e.target.value)} className={FIELD_CLASS}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="order-1 mt-auto flex flex-col gap-2 pt-2 @3xl:order-none @3xl:mt-0 @3xl:pt-0">
            <p role="alert" className="text-sm font-bold text-coral-text empty:hidden @3xl:order-last">{error}</p>
            <div className="flex flex-col gap-2 @3xl:flex-row-reverse @3xl:items-center @3xl:gap-3">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink disabled:opacity-60 @3xl:flex-1"
              >
                {pending ? "Saving…" : editing ? "Update payday" : "Finish setup"}
              </button>
              <button
                type="button"
                onClick={editing ? () => router.push("/settings") : skip}
                disabled={pending}
                className="flex h-11 items-center justify-center font-extrabold text-sea-dark @3xl:h-14 @3xl:rounded-[20px] @3xl:px-6 @3xl:hover:bg-card"
              >
                {editing ? "Cancel" : "Skip for now"}
              </button>
            </div>
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold">Regular bills</h2>
            <p className="text-sm text-muted">Monthly bills due before payday come out of Safe to spend.</p>
          </div>

          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <label htmlFor={`bill-name-${row.key}`} className="text-sm font-bold">Bill</label>
                  <input id={`bill-name-${row.key}`} value={row.name} onChange={(e) => update(row.key, { name: e.target.value })} maxLength={60} placeholder="e.g. Rent" className={FIELD_CLASS} />
                </div>
                <div className="flex w-36 flex-col gap-1">
                  <label htmlFor={`bill-amount-${row.key}`} className="text-sm font-bold">Amount</label>
                  <div className="relative">
                    <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
                    <AmountInput id={`bill-amount-${row.key}`} value={row.amount} onChange={(v) => update(row.key, { amount: v })} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                {daySelect(`bill-day-${row.key}`, row.day, (v) => update(row.key, { day: v }), "Due every")}
                {accounts.length > 0 && (
                  <div className="flex flex-1 flex-col gap-1">
                    <label htmlFor={`bill-account-${row.key}`} className="text-sm font-bold">Paid from</label>
                    <select id={`bill-account-${row.key}`} value={row.accountId} onChange={(e) => update(row.key, { accountId: e.target.value })} className={FIELD_CLASS}>
                      <option value="">Any wallet</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                  aria-label={`Remove ${row.name.trim() || "this bill"}`}
                  className="h-12 px-2 text-sm font-extrabold text-coral-text"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {unusedIdeas.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unusedIdeas.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => addBill(idea)}
                  className="h-10 rounded-full bg-card px-4 text-sm font-extrabold text-ink hover:bg-sea-tint"
                >
                  + {idea}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => addBill()}
            className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
          >
            + Add a bill
          </button>
        </section>
      </div>
    </div>
  );
}

/** Pay in a typical month from the amounts typed so far; null until every payday has one. */
function monthlyFromTexts(kind: Frequency, weeks: number[], texts: string[]): number | null {
  const amounts = texts.map((t) => (t.trim() ? parseAmount(t) : null));
  if (amounts.some((a) => a !== null && !(a > 0))) return null;
  return payPerMonth({
    frequency: kind,
    day1: 1,
    day2: kind === "twice_monthly" ? 2 : null,
    weeks: kind === "weekly" ? weeks : null,
    amounts,
    amount: null,
  });
}

/** An amount for each payday: each week of the month that pays, or each of the two days. */
function PerPaydayAmounts({
  rows,
  values,
  onChange,
  perMonth,
}: {
  rows: { key: number; label: string; hint: string }[];
  values: string[];
  onChange: (index: number, value: string) => void;
  perMonth: number | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3">
            <label htmlFor={`pay-slot-${r.key}`} className="flex min-w-0 flex-col">
              <span className="text-sm font-bold">{r.label}</span>
              <span className="text-xs text-muted">{r.hint}</span>
            </label>
            <div className="relative w-40 shrink-0">
              <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
              <AmountInput
                id={`pay-slot-${r.key}`}
                value={values[r.key] ?? ""}
                onChange={(v) => onChange(r.key, v)}
                placeholder="0.00"
                className={`${FIELD_CLASS} w-full pl-8 text-right`}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {perMonth !== null
          ? `About ${formatPeso(perMonth)} a month.`
          : "Leave one blank if you don't know it yet: it uses the average of the others."}
      </p>
    </div>
  );
}

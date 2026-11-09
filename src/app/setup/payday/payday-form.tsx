"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { finishSetup, savePaydayAndBills, type BillInput } from "@/app/setup-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import type { Account, RecurringItem } from "@/lib/data";
import { parseAmount } from "@/lib/money";
import { WEEKDAYS, type Frequency, type Schedule } from "@/lib/schedule";

type PayKind = Frequency | "irregular";

const PAY_KINDS: { value: PayKind; label: string }[] = [
  { value: "twice_monthly", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "irregular", label: "Irregular" },
];

const BILL_IDEAS = ["Rent", "Electricity", "Water", "Internet", "Phone plan", "Subscriptions"];

type BillRow = { key: number; id?: string; name: string; amount: string; day: number; accountId: string };

let nextKey = 0;

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function dayLabel(day: number) {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return day >= 29 ? `${day}${suffix} (or last day)` : `${day}${suffix}`;
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
  /** The payroll calculator works out each payday. */
  payroll: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<PayKind>(
    payday ? payday.frequency : editing ? "irregular" : "twice_monthly",
  );
  const [twice, setTwice] = useState<[number, number]>(
    payday?.frequency === "twice_monthly" ? [payday.day1, payday.day2!] : [15, 30],
  );
  const [monthDay, setMonthDay] = useState(payday?.frequency === "monthly" ? payday.day1 : 30);
  const [weekday, setWeekday] = useState(payday?.frequency === "weekly" ? payday.day1 : 5);
  const [netPay, setNetPay] = useState(payday?.amount ? String(payday.amount) : "");
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

    let schedule: Schedule | null = null;
    if (kind === "twice_monthly") {
      const [a, b] = [...twice].sort((x, y) => x - y);
      if (a === b) {
        setError("Pick two different paydays.");
        return;
      }
      schedule = { frequency: kind, day1: a, day2: b };
    } else if (kind === "monthly") {
      schedule = { frequency: kind, day1: monthDay, day2: null };
    } else if (kind === "weekly") {
      schedule = { frequency: kind, day1: weekday, day2: null };
    }

    let amount: number | null = null;
    if (schedule && netPay.trim()) {
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
        schedule,
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
            <div role="group" aria-labelledby="pay-kind" className="flex flex-wrap gap-2">
              {PAY_KINDS.map((k) => (
                <ChoiceChip
                  key={k.value}
                  selected={kind === k.value}
                  onClick={() => setKind(k.value)}
                  className={kind === k.value ? "" : "bg-mint"}
                >
                  {k.label}
                </ChoiceChip>
              ))}
            </div>

            {kind === "twice_monthly" && (
              <div className="flex gap-3">
                {daySelect("payday-1", twice[0], (v) => setTwice([v, twice[1]]), "First payday")}
                {daySelect("payday-2", twice[1], (v) => setTwice([twice[0], v]), "Second payday")}
              </div>
            )}
            {kind === "monthly" && daySelect("payday-month", monthDay, setMonthDay, "Payday")}
            {kind === "weekly" && (
              <div className="flex flex-col gap-1">
                <label htmlFor="payday-week" className="text-sm font-bold">Payday</label>
                <select id="payday-week" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={FIELD_CLASS}>
                  {WEEKDAYS.map((name, i) => (
                    <option key={name} value={i}>Every {name}</option>
                  ))}
                </select>
              </div>
            )}
            {kind === "irregular" ? (
              <p className="text-sm leading-relaxed text-muted">
                No problem. Log income when it comes in. Safe to spend needs a payday, so it
                will show your wallet total instead.
              </p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                {payroll && kind === "twice_monthly" ? (
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-sm font-bold">Pay per payday</span>
                    <p className="text-sm leading-relaxed text-muted">
                      Worked out from the days you work.{" "}
                      <Link href="/payroll" className="font-extrabold text-sea-dark underline">Payroll calculator</Link>
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col gap-1">
                    <label htmlFor="net-pay" className="text-sm font-bold">Net pay per payday <span className="font-semibold text-muted">(optional)</span></label>
                    <div className="relative">
                      <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
                      <AmountInput id="net-pay" value={netPay} onChange={setNetPay} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8`} />
                    </div>
                    {editing && kind === "twice_monthly" && (
                      <Link href="/payroll" className="text-sm font-extrabold text-sea-dark hover:underline">
                        Paid a daily rate? Use the payroll calculator
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

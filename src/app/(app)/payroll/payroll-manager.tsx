"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { removePayChange, saveContributionAmounts, saveCutoff, savePayrollSettings, setContributionDay } from "@/app/payroll-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { FormDialog } from "@/components/form-dialog";
import { ChevronIcon } from "@/components/icons";
import { addDays, formatLongDay, formatShortDay, isValidDate, type Period } from "@/lib/dates";
import { formatPeso, parseAmount } from "@/lib/money";
import {
  LEAVE_TYPES,
  RATES,
  calculatedContributions,
  changeFor,
  contributions,
  cutoffContaining,
  cutoffDaysOf,
  cutoffDaysText,
  formatCutoff,
  nextCutoff,
  previousCutoff,
  cutoffPay,
  daysFor,
  formatMinutes,
  formatTime,
  hourlyRate,
  minutesLate,
  monthlyBase,
  overtimeMinutes,
  paydayFor,
  settingsFor,
  upcomingTaxPayments,
  type ContributionKey,
  type DayStatus,
  type OvertimeEntry,
  type PayChange,
  type PayrollDay,
  type PayrollRecords,
  type PayrollSettings,
} from "@/lib/payroll";
import type { Schedule } from "@/lib/schedule";

const STATUSES: { value: DayStatus; label: string }[] = [
  { value: "worked", label: "Worked" },
  { value: "leave", label: "Leave" },
  { value: "off", label: "Off" },
];

const DEFAULT_SETTINGS: PayrollSettings = {
  dailyRate: 0,
  hoursPerDay: 8,
  startTime: "08:00",
  overtimeRate: 1,
  monthlyBase: null,
  startedOn: null,
  paySss: true,
  payPhilhealth: true,
  payPagibig: true,
  payTax: true,
  sssAmount: null,
  philhealthAmount: null,
  pagibigAmount: null,
};

export function PayrollManager({
  today,
  period,
  records,
  missing,
  payday,
  contributionDays,
}: {
  today: string;
  period: Period;
  /** Null until your pay is set up. */
  records: PayrollRecords | null;
  /** Migration 0013 hasn't been run. */
  missing: boolean;
  /** Twice-a-month payday, or null if it's set up another way. */
  payday: Schedule | null;
  /** The day each contribution's bill is due, by key ("sss"): the pay it comes out of. */
  contributionDays: Record<string, number>;
}) {
  if (missing) {
    return (
      <Notice>
        The payroll calculator needs a database update. Run <strong>step 13</strong> in{" "}
        <code>supabase/SQL_GUIDE.md</code>, then reload this page.
      </Notice>
    );
  }
  if (!payday) {
    return (
      <Notice>
        The calculator pays each cutoff on its own payday, so your payday needs to be{" "}
        <strong>twice a month</strong> (like the 15th &amp; 30th).{" "}
        <Link href="/settings/payday" className="font-extrabold text-sea-dark underline">
          Change your payday
        </Link>
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard records={records} period={period} today={today} />
      {records && (
        <>
          <CutoffCard records={records} period={period} payday={payday} today={today} />
          <SelfPaidCard records={records} today={today} payday={payday} days={contributionDays} />
        </>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[20px] bg-sun-tint p-4 text-[15px] leading-relaxed">{children}</p>;
}

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[20px] bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-11 items-center gap-2.5 text-[15px] font-bold">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-sea" />
      {children}
    </label>
  );
}

// ---------------------------------------------------------------- Your pay

function rateText(s: Pick<PayrollSettings, "dailyRate" | "hoursPerDay" | "startTime" | "overtimeRate">): string {
  return [
    `${formatPeso(s.dailyRate)} a day`,
    `${s.hoursPerDay} hours`,
    `starts ${formatTime(s.startTime)}`,
    `overtime ${s.overtimeRate}×`,
  ].join(" · ");
}

function SettingsCard({ records, period, today }: { records: PayrollRecords | null; period: Period; today: string }) {
  const [editing, setEditing] = useState(false);

  if (records) {
    // The pay for the cutoff on screen: a change from a later cutoff leaves this one as it was.
    const settings = settingsFor(records, period.start);
    const changes = records.changes ?? [];
    return (
      <Card
        title="Your pay"
        aside={
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setEditing(true)}
            className="h-10 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
          >
            Edit
          </button>
        }
      >
        <p className="text-[15px] text-muted">
          {changes.length > 0 && <strong className="text-ink">{formatCutoff(period, today)} cutoff: </strong>}
          {rateText(settings)}
        </p>
        <p className="text-[15px] text-muted">
          {formatPeso(hourlyRate(settings))} an hour · late is {formatPeso(hourlyRate(settings) / 60)} a minute
        </p>
        {changes.length > 0 && <PayByCutoff records={records} changes={changes} period={period} today={today} />}
        {editing && (
          <FormDialog title="Your pay" onClose={() => setEditing(false)}>
            <SettingsForm
              initial={settings}
              isNew={false}
              period={period}
              hasChanges={changes.length > 0}
              today={today}
              onClose={() => setEditing(false)}
            />
          </FormDialog>
        )}
      </Card>
    );
  }

  // First time: nothing else is on the page until it's set up, so it stays on it.
  return (
    <Card title="Set up your pay">
      <SettingsForm initial={DEFAULT_SETTINGS} isNew period={period} hasChanges={false} today={today} onClose={() => undefined} />
    </Card>
  );
}

/** Each pay and the cutoffs it covers: the first from your settings, then each change. */
function PayByCutoff({
  records,
  changes,
  period,
  today,
}: {
  records: PayrollRecords;
  changes: PayChange[];
  period: Period;
  today: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sorted = [...changes].sort((a, b) => a.from.localeCompare(b.from));
  const onScreen = changeFor(records, period.start);
  const rows = [
    { key: "base", when: `Until ${formatShortDay(addDays(sorted[0].from, -1), today)}`, rate: records.settings, from: null, on: onScreen === null },
    ...sorted.map((c, i) => ({
      key: c.from,
      when: sorted[i + 1]
        ? `${formatShortDay(c.from, today)} – ${formatShortDay(addDays(sorted[i + 1].from, -1), today)}`
        : `From ${formatShortDay(c.from, today)}`,
      rate: c,
      from: c.from,
      on: onScreen?.from === c.from,
    })),
  ];

  function remove(from: string) {
    setError(null);
    startTransition(async () => {
      const result = await removePayChange(from);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-extrabold">Pay by cutoff</h3>
      <ul className="flex flex-col rounded-2xl bg-mint px-3 py-1">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft py-2 last:border-0">
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-extrabold">
                {r.when}
                {r.on && <span className="ml-1.5 text-xs text-sea">Shown below</span>}
              </span>
              <span className="text-[13px] text-muted">{rateText(r.rate)}</span>
            </span>
            {r.from && (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(r.from!)}
                aria-label={`Remove the pay change from ${formatShortDay(r.from, today)}`}
                className="h-9 rounded-full px-3 text-[13px] font-extrabold text-coral-text hover:bg-coral-tint disabled:opacity-60"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
    </div>
  );
}

function SettingsForm({
  initial,
  isNew,
  period,
  hasChanges,
  today,
  onClose,
}: {
  initial: PayrollSettings;
  isNew: boolean;
  /** The cutoff on screen: a new pay starts with it unless you pick another. */
  period: Period;
  hasChanges: boolean;
  today: string;
  onClose: () => void;
}) {
  const [rate, setRate] = useState(initial.dailyRate ? String(initial.dailyRate) : "");
  const [hours, setHours] = useState(String(initial.hoursPerDay));
  const [start, setStart] = useState(initial.startTime);
  const [otRate, setOtRate] = useState(String(initial.overtimeRate));
  const [base, setBase] = useState(initial.monthlyBase ? String(initial.monthlyBase) : "");
  const [startedOn, setStartedOn] = useState(initial.startedOn ?? "");
  // The days your two cutoffs start: 3 and 18 is 3–17 and 18–2.
  const [cutoffStarts, setCutoffStarts] = useState(() => cutoffDaysOf(initial).map(String));
  const days = [Number(cutoffStarts[0]), Number(cutoffStarts[1])].sort((a, b) => a - b) as [number, number];
  const daysOk = days[0] !== days[1];
  // Every cutoff, or from the cutoff that has the date you pick (a raise on Nov 20 starts with Nov 18 – Dec 2).
  const [every, setEvery] = useState(false);
  const [fromDate, setFromDate] = useState(period.start);
  const from = every || !daysOk || !isValidDate(fromDate) ? null : cutoffContaining(fromDate, days).start;
  const [pays, setPays] = useState({
    paySss: initial.paySss,
    payPhilhealth: initial.payPhilhealth,
    payPagibig: initial.payPagibig,
    payTax: initial.payTax,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dailyRate = parseAmount(rate);
  const estimatedBase = dailyRate > 0 ? dailyRate * RATES.workDaysPerMonth : 0;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(dailyRate > 0)) {
      setError("Enter your daily rate.");
      return;
    }
    const monthly = base.trim() ? parseAmount(base) : null;
    if (monthly !== null && !(monthly > 0)) {
      setError("Check the monthly pay for contributions, or leave it blank.");
      return;
    }
    const input: PayrollSettings = {
      dailyRate,
      hoursPerDay: Number(hours),
      startTime: start,
      overtimeRate: Number(otRate),
      monthlyBase: monthly,
      startedOn: startedOn || null,
      ...pays,
      // Saved on their own, from What you pay yourself.
      sssAmount: initial.sssAmount,
      philhealthAmount: initial.philhealthAmount,
      pagibigAmount: initial.pagibigAmount,
      cutoffDays: days,
    };
    if (!daysOk) {
      setError("Pick two different days for your cutoffs.");
      return;
    }
    if (!isNew && !every && !from) {
      setError("Pick the day the new pay starts.");
      return;
    }
    startTransition(async () => {
      const result = await savePayrollSettings(input, isNew ? null : from);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-rate" className="text-sm font-bold">Daily rate</label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
            <AmountInput id="pay-rate" value={rate} onChange={setRate} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8`} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-hours" className="text-sm font-bold">Hours per day</label>
          <input id="pay-hours" type="number" inputMode="decimal" min={1} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className={FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-start" className="text-sm font-bold">Work starts at</label>
          <input id="pay-start" type="time" value={start} required onChange={(e) => setStart(e.target.value)} className={FIELD_CLASS} />
          <span className="text-xs text-muted">Every minute after this is deducted.</span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-ot" className="text-sm font-bold">Overtime rate</label>
          <select id="pay-ot" value={otRate} onChange={(e) => setOtRate(e.target.value)} className={FIELD_CLASS}>
            <option value="1">1× (your hourly rate)</option>
            <option value="1.25">1.25×</option>
            <option value="1.3">1.3×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </div>
        <fieldset className="flex flex-col gap-1 sm:col-span-2">
          <legend className="mb-1 text-sm font-bold">Your cutoffs start on the</legend>
          <div className="flex flex-wrap items-center gap-2">
            {[0, 1].map((i) => (
              <span key={i} className="contents">
                {i === 1 && <span className="font-bold text-muted">and the</span>}
                <select
                  aria-label={i === 0 ? "First cutoff starts on" : "Second cutoff starts on"}
                  value={cutoffStarts[i]}
                  onChange={(e) => setCutoffStarts((c) => (i === 0 ? [e.target.value, c[1]] : [c[0], e.target.value]))}
                  className={`${FIELD_CLASS} w-24`}
                >
                  {Array.from({ length: 28 }, (_, d) => d + 1).map((d) => (
                    <option key={d} value={d}>{ordinal(d)}</option>
                  ))}
                </select>
              </span>
            ))}
          </div>
          <span className="text-xs text-muted">
            {daysOk
              ? `Cutoffs ${cutoffDaysText(days)}. Each is paid on the first payday after it ends.`
              : "Pick two different days."}
          </span>
        </fieldset>
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-started" className="text-sm font-bold">
            Started working on <span className="font-semibold text-muted">(optional)</span>
          </label>
          <input id="pay-started" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} className={FIELD_CLASS} />
          <span className="text-xs text-muted">If it was this year, tax only counts pay from then.</span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-base" className="text-sm font-bold">
            Monthly pay for contributions <span className="font-semibold text-muted">(optional)</span>
          </label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
            <AmountInput
              id="pay-base"
              value={base}
              onChange={setBase}
              placeholder={estimatedBase ? estimatedBase.toFixed(2) : "0.00"}
              className={`${FIELD_CLASS} w-full pl-8`}
            />
          </div>
          <span className="text-xs text-muted">Blank: daily rate × {RATES.workDaysPerMonth} days.</span>
        </div>
      </div>

      {!isNew && (
        <div className="flex flex-col gap-1">
          <span id="pay-from-label" className="text-sm font-bold">Use this pay for</span>
          <div role="group" aria-labelledby="pay-from-label" className="flex flex-wrap gap-2">
            <ChoiceChip selected={!every} onClick={() => setEvery(false)}>From a date on</ChoiceChip>
            <ChoiceChip selected={every} onClick={() => setEvery(true)}>Every cutoff</ChoiceChip>
          </div>
          {!every && (
            <>
              <label htmlFor="pay-from" className="sr-only">The pay starts on</label>
              <input
                id="pay-from"
                type="date"
                value={fromDate}
                required
                onChange={(e) => setFromDate(e.target.value)}
                className={`${FIELD_CLASS} mt-1 sm:w-64`}
              />
            </>
          )}
          <span className="text-xs text-muted">
            {from
              ? `Starts with the ${formatCutoff(cutoffContaining(from, days), today)} cutoff${from === cutoffContaining(today, days).start ? " (this one)" : ""}. Cutoffs before ${formatShortDay(from, today)} keep their pay, so their paydays and tax stay the same. Contributions follow the pay of the cutoff you're in now.`
              : !every
                ? "Pick the day the new pay starts."
                : hasChanges
                ? "Replaces your pay by cutoff: every cutoff, past ones too, uses this rate."
                : "Every cutoff, past ones too, uses this rate. Got a raise? Pick the cutoff it starts with."}
          </span>
        </div>
      )}

      <fieldset className="flex flex-col gap-0.5">
        <legend className="mb-1 text-sm font-bold">You pay these yourself</legend>
        <Toggle checked={pays.paySss} onChange={(v) => setPays((p) => ({ ...p, paySss: v }))}>SSS (self-employed, 15%)</Toggle>
        <Toggle checked={pays.payPhilhealth} onChange={(v) => setPays((p) => ({ ...p, payPhilhealth: v }))}>PhilHealth (5%)</Toggle>
        <Toggle checked={pays.payPagibig} onChange={(v) => setPays((p) => ({ ...p, payPagibig: v }))}>Pag-IBIG</Toggle>
        <Toggle checked={pays.payTax} onChange={(v) => setPays((p) => ({ ...p, payTax: v }))}>Income tax, 8% option</Toggle>
      </fieldset>

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : isNew ? "Calculate my pay" : "Update pay settings"}
        </button>
        {!isNew && (
          <button type="button" onClick={onClose} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Cutoff

type OvertimeRow = OvertimeEntry & { key: number };

let nextKey = 0;

function CutoffCard({ records, period, payday, today }: { records: PayrollRecords; period: Period; payday: Schedule; today: string }) {
  // This cutoff's own pay: a raise from a later cutoff doesn't touch it.
  const settings = settingsFor(records, period.start);
  const cutoffDays = cutoffDaysOf(records.settings);
  const savedDays = useMemo(() => new Map(records.days.map((d) => [d.date, d])), [records.days]);
  const saved = records.days.some((d) => d.date >= period.start && d.date <= period.end);
  const [days, setDays] = useState<PayrollDay[]>(() => daysFor(period, savedDays, settings.startedOn));
  const [overtime, setOvertime] = useState<OvertimeRow[]>(() =>
    records.overtime.filter((o) => o.date >= period.start && o.date <= period.end).map((o) => ({ ...o, key: nextKey++ })),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pay = cutoffPay(settings, days, overtime);
  const paidOn = paydayFor(period, payday);
  const perMinute = hourlyRate(settings) / 60;

  function update(date: string, patch: Partial<PayrollDay>) {
    setNotice(null);
    setDays((ds) => ds.map((d) => (d.date === date ? { ...d, ...patch } : d)));
  }

  function setStatus(date: string, status: DayStatus) {
    update(date, {
      status,
      leaveType: status === "leave" ? "sick" : null,
      note: null,
      timeIn: null,
    });
  }

  function updateOvertime(key: number, patch: Partial<OvertimeEntry>) {
    setNotice(null);
    setOvertime((os) => os.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveCutoff({
        start: period.start,
        days,
        overtime: overtime.map(({ date, start, end }) => ({ date, start, end })),
      });
      if (result.error) setError(result.error);
      else setNotice(`Saved. Your ${formatShortDay(paidOn, today)} payday is now ${formatPeso(pay.total)}.`);
    });
  }

  return (
    <Card
      title="Cutoff"
      aside={
        <nav aria-label="Cutoffs" className="flex items-center gap-1">
          <Link
            href={`/payroll?cutoff=${previousCutoff(period, cutoffDays).start}`}
            replace
            scroll={false}
            aria-label="Previous cutoff"
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mint"
          >
            <ChevronIcon direction="left" size={20} />
          </Link>
          <span className="min-w-28 text-center text-[15px] font-extrabold">{formatCutoff(period, today)}</span>
          <Link
            href={`/payroll?cutoff=${nextCutoff(period, cutoffDays).start}`}
            replace
            scroll={false}
            aria-label="Next cutoff"
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mint"
          >
            <ChevronIcon direction="right" size={20} />
          </Link>
        </nav>
      }
    >
      <p className="text-sm text-muted">
        Paid on {formatShortDay(paidOn, today)}.{" "}
        {saved ? "Saved." : "Not saved yet: weekdays count as worked until you save."} Tap a day to mark leave or a day off,
        and add your time in if you were late.
      </p>

      <ul className="flex flex-col">
        {days.map((day) => {
          const late = day.status === "worked" ? minutesLate(day.timeIn, settings) : 0;
          const dayOvertime = overtime.filter((o) => o.date === day.date);
          return (
            <li key={day.date} className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`font-bold ${day.status === "off" ? "text-muted" : ""}`}>
                  {formatLongDay(day.date)}
                  {day.date === today && <span className="ml-1.5 text-xs font-extrabold text-sea">Today</span>}
                </span>
                <div role="group" aria-label={`${formatLongDay(day.date)}: worked, leave or off`} className="grid grid-cols-3 gap-1 rounded-xl bg-mint p-1">
                  {STATUSES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={day.status === s.value}
                      onClick={() => setStatus(day.date, s.value)}
                      className={`h-8 rounded-lg px-2.5 text-[13px] ${
                        day.status === s.value
                          ? s.value === "leave"
                            ? "bg-coral font-extrabold text-white"
                            : s.value === "worked"
                              ? "bg-sea font-extrabold text-white"
                              : "bg-ink font-extrabold text-mint"
                          : "font-bold text-muted hover:text-ink"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {day.status === "worked" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label htmlFor={`in-${day.date}`} className="text-sm font-bold text-muted">Time in</label>
                  <input
                    id={`in-${day.date}`}
                    type="time"
                    value={day.timeIn ?? ""}
                    onChange={(e) => update(day.date, { timeIn: e.target.value || null })}
                    className="h-10 rounded-xl border-2 border-line bg-card px-2 text-[15px] outline-none focus:border-sea"
                  />
                  {late > 0 ? (
                    <span className="text-sm font-bold text-coral-text">
                      {formatMinutes(late)} late · −{formatPeso(late * perMinute)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted">On time</span>
                  )}
                </div>
              )}

              {day.status === "leave" && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div role="group" aria-label="Leave type" className="flex gap-2">
                    {LEAVE_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        aria-pressed={day.leaveType === t.value}
                        onClick={() => update(day.date, { leaveType: t.value })}
                        className={`h-9 shrink-0 rounded-full px-3 text-sm font-extrabold ${
                          day.leaveType === t.value ? "bg-ink text-mint" : "bg-mint text-ink hover:bg-sea-tint"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label={`Reason for leave on ${formatLongDay(day.date)}`}
                    value={day.note ?? ""}
                    maxLength={100}
                    onChange={(e) => update(day.date, { note: e.target.value || null })}
                    placeholder="Reason (optional)"
                    className="h-10 min-w-0 flex-1 rounded-xl border-2 border-line bg-card px-3 text-[15px] outline-none focus:border-sea"
                  />
                </div>
              )}

              {dayOvertime.map((o) => (
                <div key={o.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-bold text-muted">Overtime</span>
                  <input
                    type="time"
                    aria-label="Overtime start"
                    value={o.start}
                    required
                    onChange={(e) => updateOvertime(o.key, { start: e.target.value })}
                    className="h-10 rounded-xl border-2 border-line bg-card px-2 text-[15px] outline-none focus:border-sea"
                  />
                  <span aria-hidden="true" className="text-muted">to</span>
                  <input
                    type="time"
                    aria-label="Overtime end"
                    value={o.end}
                    required
                    onChange={(e) => updateOvertime(o.key, { end: e.target.value })}
                    className="h-10 rounded-xl border-2 border-line bg-card px-2 text-[15px] outline-none focus:border-sea"
                  />
                  {o.start && o.end && o.start !== o.end && (
                    <span className="text-sm font-bold text-sea">
                      {formatMinutes(overtimeMinutes(o))} · +{formatPeso((overtimeMinutes(o) * perMinute) * settings.overtimeRate)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setOvertime((os) => os.filter((x) => x.key !== o.key))}
                    className="h-9 rounded-full px-2.5 text-sm font-extrabold text-coral-text hover:bg-coral-tint"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setOvertime((os) => [...os, { key: nextKey++, date: day.date, start: "17:00", end: "18:00" }]);
                }}
                className="self-start text-sm font-extrabold text-sea-dark hover:underline"
              >
                + Overtime
              </button>
            </li>
          );
        })}
      </ul>

      <dl className="flex flex-col gap-1.5 rounded-2xl bg-mint p-4 text-[15px]">
        <Line label={`${pay.workedDays} days × ${formatPeso(settings.dailyRate)}`} value={formatPeso(pay.basePay)} />
        {(pay.sickDays > 0 || pay.personalDays > 0) && (
          <Line
            label={[pay.sickDays && `${pay.sickDays} sick`, pay.personalDays && `${pay.personalDays} personal`].filter(Boolean).join(", ") + " leave (unpaid)"}
            value="₱0.00"
            muted
          />
        )}
        {pay.lateMinutes > 0 && <Line label={`Late, ${formatMinutes(pay.lateMinutes)}`} value={`−${formatPeso(pay.lateDeduction)}`} coral />}
        {pay.overtimeMinutes > 0 && (
          <Line label={`Overtime, ${formatMinutes(pay.overtimeMinutes)} × ${settings.overtimeRate}`} value={`+${formatPeso(pay.overtimePay)}`} />
        )}
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t-2 border-line pt-2">
          <dt className="font-extrabold">Payday, {formatShortDay(paidOn, today)}</dt>
          <dd className="font-display text-2xl font-semibold text-sea">{formatPeso(pay.total)}</dd>
        </div>
      </dl>

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <p role="status" className="text-sm font-bold text-sea-dark empty:hidden">{notice}</p>
      <button type="button" onClick={save} disabled={pending} className="h-12 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60 sm:self-start">
        {pending ? "Updating…" : "Update my payday"}
      </button>
    </Card>
  );
}

function Line({ label, value, muted, coral }: { label: string; value: string; muted?: boolean; coral?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${muted ? "text-muted" : ""} ${coral ? "text-coral-text" : ""}`}>
      <dt>{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- Bills

function SelfPaidCard({
  records,
  today,
  payday,
  days,
}: {
  records: PayrollRecords;
  today: string;
  payday: Schedule;
  days: Record<string, number>;
}) {
  // Contributions follow the pay of the cutoff you're in now.
  const settings = settingsFor(records, today);
  const [editing, setEditing] = useState(false);
  const monthly = contributions(settings);
  const taxes = settings.payTax ? upcomingTaxPayments(records, today) : [];
  const monthlyTotal = monthly.reduce((sum, c) => sum + c.amount, 0);
  const allCustom = monthly.length > 0 && monthly.every((c) => c.custom);

  return (
    <Card
      title="What you pay yourself"
      aside={
        monthly.length > 0 && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setEditing(true)}
            className="h-10 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
          >
            Edit amounts
          </button>
        )
      }
    >
      <p className="text-sm text-muted">
        These are in{" "}
        <Link href="/plan/scheduled" className="font-extrabold text-sea-dark underline">Money going out</Link>, so your
        forecast and Safe to spend set the money aside. They update when you save your pay or a cutoff.
      </p>

      {editing && (
        <FormDialog title="What you pay yourself" onClose={() => setEditing(false)}>
          <AmountsForm settings={settings} onClose={() => setEditing(false)} />
        </FormDialog>
      )}
      {monthly.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-extrabold">
            Each month · {allCustom ? "the amounts you entered" : `based on ${formatPeso(monthlyBase(settings))} a month`}
          </h3>
          <dl className="flex flex-col gap-2.5 text-[15px]">
            {monthly.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <dt className="min-w-0 flex-1">
                  {c.name}
                  {c.custom && !allCustom && <span className="block text-xs text-muted">Your amount</span>}
                </dt>
                <ContributionDay
                  contribution={c.key}
                  name={c.name}
                  day={days[c.key] ?? RATES.contributionDay}
                  paydays={[payday.day1, payday.day2 ?? RATES.contributionDay]}
                />
                <dd className="w-20 text-right font-bold">{formatPeso(c.amount)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t-2 border-line-soft pt-1.5">
              <dt className="font-extrabold">Each month</dt>
              <dd className="font-extrabold">{formatPeso(monthlyTotal)}</dd>
            </div>
          </dl>
        </div>
      )}

      {settings.payTax && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-extrabold">Income tax, 8% of yearly pay above {formatPeso(RATES.tax.exempt)}</h3>
          <dl className="flex flex-col gap-1.5 text-[15px]">
            {taxes.map((t) => (
              <div key={t.key} className="flex items-baseline justify-between gap-3">
                <dt>
                  {t.name.replace("Income tax 8%, ", "")}
                  <span className="block text-xs text-muted">
                    Due {formatShortDay(t.dueOn, today)} · pay so far {formatPeso(t.grossToDate)}
                  </span>
                </dt>
                <dd className={`font-bold ${t.amount ? "" : "text-muted"}`}>{t.amount ? formatPeso(t.amount) : "Nothing due"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">
            Cutoffs you haven&apos;t saved count as a normal work week, so these are estimates until the year is in.
          </p>
        </div>
      )}

      {!monthly.length && !settings.payTax && <p className="text-[15px] text-muted">You haven&apos;t picked any. Edit your pay to add them.</p>}
    </Card>
  );
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Which pay a contribution comes out of: the 15th or the 30th. */
function ContributionDay({
  contribution,
  name,
  day,
  paydays,
}: {
  contribution: ContributionKey;
  name: string;
  day: number;
  paydays: number[];
}) {
  const [picked, setPicked] = useState(day);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Due on a day that isn't one of your paydays (your payday changed): neither is picked until you choose.
  const current = paydays.includes(picked) ? picked : null;
  return (
    <span className="flex flex-col items-end">
      <span role="group" aria-label={`${name}: which pay it comes out of`} className="flex rounded-full bg-mint p-0.5">
        {paydays.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={current === p}
            disabled={pending}
            onClick={() => {
              if (p === current) return;
              const before = picked;
              setPicked(p);
              setError(null);
              startTransition(async () => {
                const result = await setContributionDay(contribution, p);
                if (result.error) {
                  setPicked(before);
                  setError(result.error);
                }
              });
            }}
            className={`h-8 rounded-full px-3 text-xs font-extrabold disabled:opacity-60 ${
              current === p ? "bg-sea text-white" : "text-muted hover:text-ink"
            }`}
          >
            {ordinal(p)} pay
          </button>
        ))}
      </span>
      <span role="alert" className="text-xs font-bold text-coral-text empty:hidden">{error}</span>
    </span>
  );
}

const AMOUNT_FIELDS = [
  { key: "sss", field: "sssAmount", on: "paySss", label: "SSS" },
  { key: "philhealth", field: "philhealthAmount", on: "payPhilhealth", label: "PhilHealth" },
  { key: "pagibig", field: "pagibigAmount", on: "payPagibig", label: "Pag-IBIG" },
] as const;

/** Your company's own amounts. Blank uses the calculated one. */
function AmountsForm({ settings, onClose }: { settings: PayrollSettings; onClose: () => void }) {
  const calculated = calculatedContributions(settings);
  const fields = AMOUNT_FIELDS.filter((f) => settings[f.on]);
  const [values, setValues] = useState(() =>
    Object.fromEntries(AMOUNT_FIELDS.map((f) => [f.field, settings[f.field] === null ? "" : String(settings[f.field])])) as Record<
      (typeof AMOUNT_FIELDS)[number]["field"],
      string
    >,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = { sssAmount: null, philhealthAmount: null, pagibigAmount: null } as Record<
      (typeof AMOUNT_FIELDS)[number]["field"],
      number | null
    >;
    for (const f of AMOUNT_FIELDS) {
      const text = values[f.field].trim();
      if (!text) continue;
      const amount = parseAmount(text);
      if (!(amount > 0)) {
        setError(`Check the ${f.label} amount, or leave it blank to use the calculated one.`);
        return;
      }
      parsed[f.field] = amount;
    }
    startTransition(async () => {
      const result = await saveContributionAmounts(parsed);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <p className="text-[15px]">
        Enter what your company actually takes each month. Leave one blank to use the standard rate, based on{" "}
        {formatPeso(monthlyBase(settings))} a month.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={`own-${f.key}`} className="text-sm font-bold">{f.label}</label>
            <div className="relative">
              <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
              <AmountInput
                id={`own-${f.key}`}
                value={values[f.field]}
                onChange={(v) => setValues((vs) => ({ ...vs, [f.field]: v }))}
                placeholder={calculated[f.key].toFixed(2)}
                className={`${FIELD_CLASS} w-full pl-8`}
              />
            </div>
            <span className="text-xs text-muted">Blank: {formatPeso(calculated[f.key])}, calculated.</span>
          </div>
        ))}
      </div>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : "Use these amounts"}
        </button>
        <button type="button" onClick={onClose} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
          Cancel
        </button>
      </div>
    </form>
  );
}

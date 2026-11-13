"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  removeCutoffChange,
  removePayChange,
  saveContributionAmounts,
  saveCutoff,
  saveCutoffChange,
  savePayrollSettings,
  setContributionDay,
} from "@/app/payroll-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { FormDialog } from "@/components/form-dialog";
import { ChevronIcon } from "@/components/icons";
import { PaydayPicker, choiceFrom, ordinal, scheduleFrom, type PayKind } from "@/components/payday-picker";
import { addDays, formatLongDay, formatShortDay, isValidDate, weekdayOf, type Period } from "@/lib/dates";
import { formatPeso, parseAmount } from "@/lib/money";
import {
  DEFAULT_CUTOFF_WEEKDAY,
  LEAVE_TYPES,
  RATES,
  WEEKEND_MODES,
  calculatedContributions,
  changeFor,
  changeOf,
  contributions,
  coversText,
  cutoffChangeProblem,
  cutoffContaining,
  cutoffDaysOf,
  cutoffPay,
  cutoffRuleOf,
  cutoffRuleText,
  cutoffsPaidOn,
  dailyFromMonthly,
  dayKind,
  daysFor,
  formatCutoff,
  formatMinutes,
  formatTime,
  hourlyRate,
  minutesLate,
  monthlyBase,
  nextCutoff,
  overtimeMinutes,
  pageRule,
  payForCutoff,
  paydayFor,
  previousCutoff,
  settingsFor,
  shareOf,
  upcomingTaxPayments,
  usualCutoff,
  usualFor,
  type ContributionKey,
  type CutoffRule,
  type DayStatus,
  type OvertimeEntry,
  type PayChange,
  type PayrollDay,
  type PayrollRecords,
  type PayrollSettings,
  type WeekendMode,
} from "@/lib/payroll";
import { MAX_GAP_DAYS, SHORT_WEEKDAYS, WEEKDAYS, describeSchedule, occurrences, type Frequency, type Schedule } from "@/lib/schedule";

const STATUSES: { value: DayStatus; label: string }[] = [
  { value: "worked", label: "Worked" },
  { value: "leave", label: "Leave" },
  { value: "off", label: "Off" },
];

/** How you're paid, in the calculator: no "irregular", it needs paydays. */
const PAY_KINDS: PayKind[] = ["daily", "weekly", "twice_monthly", "monthly"];

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
  /** The cutoff on screen; with daily pay, the week. */
  period: Period;
  /** Null until your pay is set up. */
  records: PayrollRecords | null;
  /** Migration 0013 hasn't been run. */
  missing: boolean;
  /** Your payday. Null when pay is irregular: Your pay sets one. */
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

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard records={records} period={period} today={today} payday={payday} />
      {records && payday && (
        <>
          <CutoffCard records={records} period={period} payday={payday} today={today} />
          <SelfPaidCard records={records} today={today} payday={payday} days={contributionDays} />
        </>
      )}
      {records && !payday && <Notice>Pick when you get paid (Your pay › Edit), so each cutoff has a payday.</Notice>}
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

function rateText(s: Pick<PayrollSettings, "dailyRate" | "hoursPerDay" | "startTime" | "overtimeRate" | "monthlyPay">): string {
  return [
    s.monthlyPay ? `${formatPeso(s.monthlyPay)} a month (${formatPeso(s.dailyRate)} a day)` : `${formatPeso(s.dailyRate)} a day`,
    `${s.hoursPerDay} hours`,
    `starts ${formatTime(s.startTime)}`,
    `overtime ${s.overtimeRate}×`,
  ].join(" · ");
}

function weekendText(s: Pick<PayrollSettings, "saturday" | "sunday">): string {
  const label = (m: WeekendMode | undefined) => WEEKEND_MODES.find((w) => w.value === (m ?? "off"))!.label.toLowerCase();
  return `Saturdays ${label(s.saturday)} · Sundays ${label(s.sunday)}`;
}

function SettingsCard({
  records,
  period,
  today,
  payday,
}: {
  records: PayrollRecords | null;
  period: Period;
  today: string;
  payday: Schedule | null;
}) {
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
          {payday ? (
            <>
              <strong className="text-ink">Paid {describeSchedule(payday).replace(/^Every/, "every")}</strong> ·{" "}
              {coversText(cutoffRuleOf(records.settings))}
            </>
          ) : (
            "No payday yet: pick when you get paid."
          )}
        </p>
        <p className="text-[15px] text-muted">
          {weekendText(records.settings)} · late is {formatPeso(hourlyRate(settings) / 60)} a minute
        </p>
        {changes.length > 0 && <PayByCutoff records={records} changes={changes} period={period} today={today} />}
        {editing && (
          <FormDialog title="Your pay" onClose={() => setEditing(false)} wide>
            <SettingsForm
              initial={settings}
              records={records}
              payday={payday}
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
      <SettingsForm
        initial={{ ...DEFAULT_SETTINGS, frequency: payday?.frequency }}
        records={null}
        payday={payday}
        isNew
        period={period}
        hasChanges={false}
        today={today}
        onClose={() => undefined}
      />
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

/** A segmented row of choices: Per day / Per month, Off / Regular day / Overtime. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={`grid gap-1 rounded-xl bg-mint p-1`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-9 rounded-lg px-2 text-sm ${value === o.value ? "bg-card font-extrabold" : "font-bold text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SettingsForm({
  initial,
  records,
  payday,
  isNew,
  period,
  hasChanges,
  today,
  onClose,
}: {
  initial: PayrollSettings;
  /** Your saved days, for the paydays preview. Null the first time. */
  records: PayrollRecords | null;
  payday: Schedule | null;
  isNew: boolean;
  /** The cutoff on screen: a new pay starts with it unless you pick another. */
  period: Period;
  hasChanges: boolean;
  today: string;
  onClose: () => void;
}) {
  const [rateType, setRateType] = useState<"day" | "month">(initial.monthlyPay ? "month" : "day");
  const [rate, setRate] = useState(initial.dailyRate && !initial.monthlyPay ? String(initial.dailyRate) : "");
  const [monthly, setMonthly] = useState(initial.monthlyPay ? String(initial.monthlyPay) : "");
  const [hours, setHours] = useState(String(initial.hoursPerDay));
  const [start, setStart] = useState(initial.startTime);
  const [otRate, setOtRate] = useState(String(initial.overtimeRate));
  const [base, setBase] = useState(initial.monthlyBase ? String(initial.monthlyBase) : "");
  const [startedOn, setStartedOn] = useState(initial.startedOn ?? "");
  const [saturday, setSaturday] = useState<WeekendMode>(initial.saturday ?? "off");
  const [sunday, setSunday] = useState<WeekendMode>(initial.sunday ?? "off");
  // When you get paid: sets your payday too.
  const [choice, setChoice] = useState(() => choiceFrom(payday, "twice_monthly"));
  const frequency: Frequency = choice.kind === "irregular" ? "twice_monthly" : choice.kind;
  const picked = scheduleFrom(choice);
  // What each pay covers. Twice a month: the days your two cutoffs start
  // (3 and 18 is 3–17 and 18–2). Weekly: the day your week starts. Monthly:
  // the day your month starts. Daily: the day itself.
  const [cutoffStarts, setCutoffStarts] = useState(() => cutoffDaysOf(initial).map(String));
  const [weekday, setWeekday] = useState(initial.cutoffWeekday ?? DEFAULT_CUTOFF_WEEKDAY);
  const [monthDay, setMonthDay] = useState(initial.cutoffMonthDay ?? 1);
  const pickedDays = [Number(cutoffStarts[0]), Number(cutoffStarts[1])].sort((a, b) => a - b) as [number, number];
  const daysOk = frequency !== "twice_monthly" || pickedDays[0] !== pickedDays[1];
  // Only the cutoffs for how you're paid change; the others keep what they were.
  const days = frequency === "twice_monthly" && daysOk ? pickedDays : cutoffDaysOf(initial);
  // Every cutoff, or from the cutoff that has the date you pick (a raise on Nov 20 starts with Nov 18 – Dec 2).
  const [every, setEvery] = useState(false);
  const [fromDate, setFromDate] = useState(period.start);
  const [pays, setPays] = useState({
    paySss: initial.paySss,
    payPhilhealth: initial.payPhilhealth,
    payPagibig: initial.payPagibig,
    payTax: initial.payTax,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const monthlyPay = rateType === "month" ? parseAmount(monthly) : NaN;
  const dailyRate = rateType === "month" ? (monthlyPay > 0 ? dailyFromMonthly(monthlyPay) : NaN) : parseAmount(rate);
  const formSettings: PayrollSettings = {
    ...initial,
    dailyRate: dailyRate > 0 ? dailyRate : 0,
    hoursPerDay: Number(hours) || 8,
    startTime: start,
    overtimeRate: Number(otRate) || 1,
    monthlyPay: rateType === "month" && monthlyPay > 0 ? monthlyPay : null,
    saturday,
    sunday,
    frequency,
    cutoffDays: days,
    cutoffWeekday: weekday,
    cutoffMonthDay: monthDay,
  };
  const rule = cutoffRuleOf(formSettings);
  const from = every || !daysOk || !isValidDate(fromDate) ? null : cutoffContaining(fromDate, rule).start;
  const estimatedBase = dailyRate > 0 ? (formSettings.monthlyPay ?? dailyRate * RATES.workDaysPerMonth) : 0;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rateType === "month" ? !(monthlyPay > 0) : !(dailyRate > 0)) {
      setError(rateType === "month" ? "Enter your monthly pay." : "Enter your daily rate.");
      return;
    }
    if (picked.error || !picked.schedule) {
      setError(picked.error ?? "Pick when you get paid.");
      return;
    }
    const contributionBase = base.trim() ? parseAmount(base) : null;
    if (contributionBase !== null && !(contributionBase > 0)) {
      setError("Check the monthly pay for contributions, or leave it blank.");
      return;
    }
    if (!daysOk) {
      setError("Pick two different days for your cutoffs.");
      return;
    }
    if (!isNew && !every && !from) {
      setError("Pick the day the new pay starts.");
      return;
    }
    const input: PayrollSettings = {
      ...formSettings,
      monthlyBase: contributionBase,
      startedOn: startedOn || null,
      ...pays,
      // Saved on their own, from What you pay yourself.
      sssAmount: initial.sssAmount,
      philhealthAmount: initial.philhealthAmount,
      pagibigAmount: initial.pagibigAmount,
      // Read with your settings, saved on their own.
      cutoffChanges: undefined,
    };
    startTransition(async () => {
      const result = await savePayrollSettings(input, isNew ? null : from, picked.schedule);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-bold">Rate</legend>
        <Segmented
          label="Rate"
          value={rateType}
          options={[
            { value: "day", label: "Per day" },
            { value: "month", label: "Per month" },
          ]}
          onChange={setRateType}
        />
        {rateType === "day" ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="pay-rate" className="text-sm font-bold">Daily rate</label>
            <div className="relative sm:w-64">
              <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
              <AmountInput id="pay-rate" value={rate} onChange={setRate} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8`} />
            </div>
            <span className="text-xs text-muted">No work, no pay: each payday is the days you worked × this.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="pay-monthly" className="text-sm font-bold">Monthly pay</label>
            <div className="relative sm:w-64">
              <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
              <AmountInput id="pay-monthly" value={monthly} onChange={setMonthly} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8`} />
            </div>
            <span className="text-xs text-muted">
              {dailyRate > 0
                ? `A work day you miss takes off ${formatPeso(dailyRate)} (÷ ${RATES.workDaysPerMonth}).`
                : `A work day you miss takes off your monthly pay ÷ ${RATES.workDaysPerMonth}.`}
            </span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="pay-hours" className="text-sm font-bold">Hours per day</label>
            <input id="pay-hours" type="number" inputMode="decimal" min={1} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pay-start" className="text-sm font-bold">Work starts at</label>
            <input id="pay-start" type="time" value={start} required onChange={(e) => setStart(e.target.value)} className={FIELD_CLASS} />
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
        </div>
        <span className="text-xs text-muted">Every minute after work starts is deducted.</span>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">Work days</legend>
        <p className="text-sm text-muted">Monday to Friday are regular days.</p>
        {(
          [
            ["Saturdays", saturday, setSaturday],
            ["Sundays", sunday, setSunday],
          ] as const
        ).map(([name, value, set]) => (
          <div key={name} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-sm font-bold">{name}</span>
            <Segmented label={name} value={value} options={WEEKEND_MODES} onChange={set} />
          </div>
        ))}
        <span className="text-xs text-muted">
          Regular day: a day&apos;s pay, and late counts. Overtime: only the hours you work, at your overtime rate.
        </span>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend id="pay-when" className="mb-1 text-sm font-bold">When do you get paid?</legend>
        <PaydayPicker value={choice} onChange={setChoice} kinds={PAY_KINDS} idPrefix="pay-when" labelledBy="pay-when" />

        {frequency === "twice_monthly" && (
          <div className="flex flex-col gap-1">
            <span id="cutoff-starts" className="text-sm font-bold">Cutoffs start on the</span>
            <div role="group" aria-labelledby="cutoff-starts" className="flex flex-wrap items-center gap-2">
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
            <span className="text-xs text-muted">{daysOk ? `Cutoffs ${cutoffRuleText(rule)}.` : "Pick two different days."}</span>
          </div>
        )}
        {(frequency === "weekly" || frequency === "monthly") && (
          <div className="flex flex-col gap-1">
            <label htmlFor="cutoff-start" className="text-sm font-bold">
              {frequency === "weekly" ? "Your work week starts on" : "Your cutoff starts on the"}
            </label>
            {frequency === "weekly" ? (
              <select id="cutoff-start" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={`${FIELD_CLASS} sm:w-48`}>
                {WEEKDAYS.map((name, i) => (
                  <option key={name} value={i}>{name}</option>
                ))}
              </select>
            ) : (
              <select id="cutoff-start" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} className={`${FIELD_CLASS} sm:w-48`}>
                {Array.from({ length: 28 }, (_, d) => d + 1).map((d) => (
                  <option key={d} value={d}>{ordinal(d)}</option>
                ))}
              </select>
            )}
            <span className="text-xs text-muted">{`Each cutoff runs ${cutoffRuleText(rule)}.`}</span>
          </div>
        )}

        <NextPaydays settings={formSettings} records={records} schedule={picked.schedule} today={today} />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
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
          <span className="text-xs text-muted">
            {rateType === "month" ? "Blank: your monthly pay." : `Blank: daily rate × ${RATES.workDaysPerMonth} days.`}
          </span>
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
              ? `Starts with the ${formatCutoff(cutoffContaining(from, rule), today)} cutoff${from === cutoffContaining(today, rule).start ? " (this one)" : ""}. Cutoffs before ${formatShortDay(from, today)} keep their pay, so their paydays and tax stay the same. Your paydays, weekends and contributions change for every cutoff.`
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

/** Your next three paydays with the form as it is: what each pays for, and how much. */
function NextPaydays({
  settings,
  records,
  schedule,
  today,
}: {
  settings: PayrollSettings;
  records: PayrollRecords | null;
  schedule: Schedule | null;
  today: string;
}) {
  if (!schedule || !(settings.dailyRate > 0)) return null;
  const rule = cutoffRuleOf({ ...settings, cutoffChanges: records?.settings.cutoffChanges });
  // This pay for every cutoff: a preview, not your pay by cutoff.
  const preview: PayrollRecords = { settings: { ...settings, cutoffChanges: records?.settings.cutoffChanges }, days: records?.days ?? [], overtime: records?.overtime ?? [] };
  const dates = occurrences(schedule, today, addDays(today, MAX_GAP_DAYS + 1)).slice(0, 3);
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-extrabold">Your next paydays</h3>
      <ul className="flex flex-col rounded-2xl bg-mint px-3 py-1 text-sm">
        {dates.map((date) => {
          const cutoffs = cutoffsPaidOn(date, schedule, rule);
          const pays = cutoffs.map((c) => payForCutoff(preview, c, today));
          const covers = { start: cutoffs[0].start, end: cutoffs.at(-1)!.end };
          const worked = pays.reduce((s, p) => s + p.workedDays, 0);
          const total = pays.reduce((s, p) => s + p.total, 0);
          return (
            <li key={date} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line-soft py-2 last:border-0">
              <span>
                <strong>{formatShortDay(date, today)}</strong>{" "}
                <span className="text-muted">
                  pays {covers.start === covers.end ? formatShortDay(covers.start, today) : formatCutoff(covers, today)} · {worked}{" "}
                  {worked === 1 ? "day" : "days"}
                </span>
              </span>
              <span className="font-bold">{formatPeso(total)}</span>
            </li>
          );
        })}
      </ul>
      <span className="text-xs text-muted">Days you haven&apos;t marked count as your usual work days.</span>
    </div>
  );
}

// ---------------------------------------------------------------- Cutoff

type OvertimeRow = OvertimeEntry & { key: number };

let nextKey = 0;

/** "Half of monthly pay", "A week of monthly pay (× 12 ÷ 52)". */
function shareLabel(share: number): string {
  if (share === 1) return "Monthly pay";
  if (share === 0.5) return "Half of monthly pay";
  return "A week of monthly pay (× 12 ÷ 52)";
}

function CutoffCard({ records, period, payday, today }: { records: PayrollRecords; period: Period; payday: Schedule; today: string }) {
  // This cutoff's own pay: a raise from a later cutoff doesn't touch it.
  const settings = settingsFor(records, period.start);
  const rule = cutoffRuleOf(records.settings);
  // Daily pay: a week on screen, each day paid on its own payday.
  const daily = rule.every === "day";
  const page = pageRule(rule);
  const savedDays = useMemo(() => new Map(records.days.map((d) => [d.date, d])), [records.days]);
  const saved = records.days.some((d) => d.date >= period.start && d.date <= period.end);
  const [days, setDays] = useState<PayrollDay[]>(() => daysFor(period, savedDays, settings.startedOn, settings));
  const [overtime, setOvertime] = useState<OvertimeRow[]>(() =>
    records.overtime.filter((o) => o.date >= period.start && o.date <= period.end).map((o) => ({ ...o, key: nextKey++ })),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  // The day being edited, and the cutoff as it was when you tapped it.
  const [open, setOpen] = useState<{ date: string; days: PayrollDay[]; overtime: OvertimeRow[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const pay = cutoffPay(settings, days, overtime, daily ? null : shareOf(rule));
  const paidOn = daily ? null : paydayFor(period, payday, rule);
  // Only every other Friday pays: that payday covers this week and others.
  const paidWith = paidOn ? cutoffsPaidOn(paydayFor(period, payday), payday, rule).length - 1 : 0;
  const changed = daily ? null : changeOf(period, rule);
  const editingDay = open ? days.find((d) => d.date === open.date) : undefined;

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

  /** A weekend set as overtime: worked means its overtime hours, off means none. */
  function setOvertimeDay(date: string, worked: boolean) {
    setStatus(date, worked ? "worked" : "off");
    setOvertime((os) =>
      worked
        ? os.some((o) => o.date === date)
          ? os
          : [...os, { key: nextKey++, date, start: settings.startTime, end: "12:00" }]
        : os.filter((o) => o.date !== date),
    );
  }

  function updateOvertime(key: number, patch: Partial<OvertimeEntry>) {
    setNotice(null);
    setOvertime((os) => os.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function addOvertime(date: string) {
    setNotice(null);
    setOvertime((os) => [...os, { key: nextKey++, date, start: "17:00", end: "18:00" }]);
  }

  function openDay(date: string) {
    setOpen({ date, days, overtime });
  }

  /** ✕ or Cancel: the day goes back to how it was when you tapped it. */
  function cancelDay() {
    if (open) {
      setDays(open.days);
      setOvertime(open.overtime);
    }
    setOpen(null);
  }

  function save(onSaved?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveCutoff({
        start: period.start,
        days,
        overtime: overtime.map(({ date, start, end }) => ({ date, start, end })),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved?.();
      if (daily) setNotice(`Saved. This week's pay is ${formatPeso(pay.total)}.`);
      else if (paidWith > 0) setNotice(`Saved. ${formatPeso(pay.total)} of your ${formatShortDay(paidOn!, today)} payday is from this cutoff.`);
      else setNotice(`Saved. Your ${formatShortDay(paidOn!, today)} payday is now ${formatPeso(pay.total)}.`);
    });
  }

  return (
    <Card
      title={daily ? "This week" : "Cutoff"}
      aside={
        <nav aria-label={daily ? "Weeks" : "Cutoffs"} className="flex items-center gap-1">
          <Link
            href={`/payroll?cutoff=${previousCutoff(period, page).start}`}
            replace
            scroll={false}
            aria-label={daily ? "Previous week" : "Previous cutoff"}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mint"
          >
            <ChevronIcon direction="left" size={20} />
          </Link>
          <span className="min-w-28 text-center text-[15px] font-extrabold">{formatCutoff(period, today)}</span>
          <Link
            href={`/payroll?cutoff=${nextCutoff(period, page).start}`}
            replace
            scroll={false}
            aria-label={daily ? "Next week" : "Next cutoff"}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mint"
          >
            <ChevronIcon direction="right" size={20} />
          </Link>
        </nav>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {daily ? (
            "Each day's pay is handed over on that day's payday."
          ) : (
            <>
              Paid on {formatShortDay(paidOn!, today)}
              {paidWith > 0 && `, with ${paidWith === 1 ? "the cutoff" : `the ${paidWith} cutoffs`} before it`}.
              {changed && (
                <span className="ml-1.5 rounded-full bg-sun-tint px-2 py-0.5 text-xs font-extrabold text-ink">Changed dates</span>
              )}
            </>
          )}
        </p>
        {!daily && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setChanging(true)}
            className="h-9 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
          >
            Change this cutoff&apos;s dates
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        {saved ? "Saved." : "Not saved yet: your usual work days count as worked until you save."} Tap a day to mark leave or a
        day off, add your time in if you were late, or add overtime.
      </p>
      {changing && (
        <FormDialog title="Change this cutoff" onClose={() => setChanging(false)}>
          <CutoffChangeForm period={period} rule={rule} payday={payday} today={today} onClose={() => setChanging(false)} />
        </FormDialog>
      )}

      <CutoffCalendar days={days} overtime={overtime} settings={settings} today={today} onOpen={openDay} />

      {editingDay && (
        <FormDialog title={formatLongDay(editingDay.date)} onClose={cancelDay}>
          <div className="flex flex-col gap-4">
            <DayEditor
              day={editingDay}
              overtime={overtime.filter((o) => o.date === editingDay.date)}
              settings={settings}
              today={today}
              onStatus={(status) => setStatus(editingDay.date, status)}
              onOvertimeDay={(worked) => setOvertimeDay(editingDay.date, worked)}
              onChange={(patch) => update(editingDay.date, patch)}
              onAddOvertime={() => addOvertime(editingDay.date)}
              onChangeOvertime={updateOvertime}
              onRemoveOvertime={(key) => setOvertime((os) => os.filter((x) => x.key !== key))}
            />
            <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => save(() => setOpen(null))}
                disabled={pending}
                className="h-12 flex-1 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60 sm:flex-none"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={cancelDay} className="h-12 rounded-[14px] px-5 font-extrabold text-ink hover:bg-card">
                Cancel
              </button>
            </div>
          </div>
        </FormDialog>
      )}

      <dl className="flex flex-col gap-1.5 rounded-2xl bg-mint p-4 text-[15px]">
        {pay.share !== null ? (
          <>
            <Line label={shareLabel(pay.share)} value={formatPeso(pay.basePay - pay.extraDays * settings.dailyRate)} />
            {pay.extraDays > 0 && (
              <Line label={`${pay.extraDays} usual day${pay.extraDays === 1 ? "" : "s"} off worked × ${formatPeso(settings.dailyRate)}`} value={`+${formatPeso(pay.extraDays * settings.dailyRate)}`} />
            )}
            {pay.missedDays > 0 && (
              <Line
                label={`${pay.missedDays} work day${pay.missedDays === 1 ? "" : "s"} missed, no pay`}
                value={`−${formatPeso(pay.missedDeduction)}`}
                coral
              />
            )}
          </>
        ) : (
          <Line label={`${pay.workedDays} days × ${formatPeso(settings.dailyRate)}`} value={formatPeso(pay.basePay)} />
        )}
        {pay.share === null && (pay.sickDays > 0 || pay.personalDays > 0) && (
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
          <dt className="font-extrabold">
            {daily ? "This week" : `${paidWith > 0 ? "This cutoff" : "Payday"}, ${formatShortDay(paidOn!, today)}`}
          </dt>
          <dd className="font-display text-2xl font-semibold text-sea">{formatPeso(pay.total)}</dd>
        </div>
      </dl>

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <p role="status" className="text-sm font-bold text-sea-dark empty:hidden">{notice}</p>
      <button type="button" onClick={() => save()} disabled={pending} className="h-12 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60 sm:self-start">
        {pending ? "Updating…" : daily ? "Save this week" : "Update my payday"}
      </button>
    </Card>
  );
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });

/** Minutes of overtime that day, skipping rows still missing a time. */
function overtimeOn(date: string, overtime: OvertimeEntry[]): number {
  return overtime
    .filter((o) => o.date === date && o.start && o.end && o.start !== o.end)
    .reduce((sum, o) => sum + overtimeMinutes(o), 0);
}

/** The cutoff's days on a Sunday-first calendar. Tap a day to edit it. */
function CutoffCalendar({
  days,
  overtime,
  settings,
  today,
  onOpen,
}: {
  days: PayrollDay[];
  overtime: OvertimeEntry[];
  settings: PayrollSettings;
  today: string;
  onOpen: (date: string) => void;
}) {
  const blanks = days.length > 0 ? weekdayOf(days[0].date) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden="true" className="grid grid-cols-7 gap-1 text-center text-xs font-extrabold text-muted sm:gap-1.5">
        {SHORT_WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <ul className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: blanks }, (_, i) => (
          <li key={`blank-${i}`} aria-hidden="true" />
        ))}
        {days.map((day, i) => {
          const overtimeDay = dayKind(day.date, settings) === "overtime";
          const late = day.status === "worked" && !overtimeDay ? minutesLate(day.timeIn, settings) : 0;
          const extra = overtimeOn(day.date, overtime);
          const dayNumber = Number(day.date.slice(8));
          const label =
            day.status === "leave"
              ? day.leaveType === "personal"
                ? "Personal leave"
                : "Sick leave"
              : day.status === "off"
                ? "Off"
                : overtimeDay
                  ? "Overtime"
                  : "Worked";
          const tone =
            day.status === "leave" ? "bg-coral-tint" : day.status === "off" ? "bg-mint text-muted" : "bg-sea-tint";
          const details = [label, late > 0 && `${formatMinutes(late)} late`, extra > 0 && `${formatMinutes(extra)} overtime`]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={day.date}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`${formatLongDay(day.date)}${day.date === today ? " (today)" : ""}: ${details}`}
                onClick={() => onOpen(day.date)}
                className={`flex h-full min-h-14 w-full flex-col items-start gap-0.5 rounded-xl p-1.5 text-left hover:ring-2 hover:ring-sea/40 sm:min-h-20 sm:p-2 ${tone} ${
                  day.date === today ? "ring-2 ring-sea" : ""
                }`}
              >
                <span className="flex items-baseline gap-1 leading-none">
                  <span className="text-sm font-extrabold sm:text-[15px]">{dayNumber}</span>
                  {(i === 0 || dayNumber === 1) && (
                    <span className="text-[10px] font-extrabold uppercase text-muted">{MONTH.format(new Date(day.date))}</span>
                  )}
                </span>
                <span className="hidden text-xs font-bold sm:block">{label}</span>
                {late > 0 && (
                  <span className="text-[11px] font-extrabold leading-tight text-coral-text">
                    <span className="sm:hidden">Late</span>
                    <span className="hidden sm:inline">{formatMinutes(late)} late</span>
                  </span>
                )}
                {extra > 0 && (
                  <span className="text-[11px] font-extrabold leading-tight text-sea-dark">
                    +<span className="sm:hidden">OT</span>
                    <span className="hidden sm:inline">{formatMinutes(extra)} OT</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-muted">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-sea-tint" />Worked</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-coral-tint" />Leave</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-line bg-mint" />Off</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded ring-2 ring-sea" />Today</span>
      </div>
    </div>
  );
}

/** One day of the cutoff, in its dialog: worked, leave or off, time in, overtime. */
function DayEditor({
  day,
  overtime,
  settings,
  today,
  onStatus,
  onOvertimeDay,
  onChange,
  onAddOvertime,
  onChangeOvertime,
  onRemoveOvertime,
}: {
  day: PayrollDay;
  overtime: OvertimeRow[];
  settings: PayrollSettings;
  today: string;
  onStatus: (status: DayStatus) => void;
  onOvertimeDay: (worked: boolean) => void;
  onChange: (patch: Partial<PayrollDay>) => void;
  onAddOvertime: () => void;
  onChangeOvertime: (key: number, patch: Partial<OvertimeEntry>) => void;
  onRemoveOvertime: (key: number) => void;
}) {
  const kind = dayKind(day.date, settings);
  const overtimeDay = kind === "overtime";
  const late = day.status === "worked" && !overtimeDay ? minutesLate(day.timeIn, settings) : 0;
  const perMinute = hourlyRate(settings) / 60;
  const segment = (selected: boolean, tone: string) =>
    `h-11 rounded-lg px-2.5 text-[15px] ${selected ? `${tone} font-extrabold` : "font-bold text-muted hover:text-ink"}`;

  return (
    <div className="flex flex-col gap-4">
      {(overtimeDay || day.date === today) && (
        <p className="text-sm text-muted">
          {day.date === today && <span className="font-extrabold text-sea">Today. </span>}
          {overtimeDay && "An overtime day: only the hours you work count, at your overtime rate."}
        </p>
      )}

      {overtimeDay ? (
        <div role="group" aria-label="Off or overtime" className="grid grid-cols-2 gap-1 rounded-xl bg-card p-1">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              type="button"
              aria-pressed={(day.status === "worked") === on}
              onClick={() => onOvertimeDay(on)}
              className={segment((day.status === "worked") === on, on ? "bg-sea text-white" : "bg-ink text-mint")}
            >
              {on ? "Overtime" : "Off"}
            </button>
          ))}
        </div>
      ) : (
        <div role="group" aria-label="Worked, leave or off" className="grid grid-cols-3 gap-1 rounded-xl bg-card p-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={day.status === s.value}
              onClick={() => onStatus(s.value)}
              className={segment(
                day.status === s.value,
                s.value === "leave" ? "bg-coral text-white" : s.value === "worked" ? "bg-sea text-white" : "bg-ink text-mint",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {day.status === "worked" && !overtimeDay && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`in-${day.date}`} className="text-sm font-bold">Time in</label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input
              id={`in-${day.date}`}
              type="time"
              value={day.timeIn ?? ""}
              onChange={(e) => onChange({ timeIn: e.target.value || null })}
              className="h-12 rounded-xl border-2 border-line bg-card px-3 text-[15px] outline-none focus:border-sea"
            />
            {late > 0 ? (
              <span className="text-sm font-bold text-coral-text">
                {formatMinutes(late)} late · −{formatPeso(late * perMinute)}
              </span>
            ) : (
              <span className="text-sm text-muted">On time</span>
            )}
          </div>
          {kind === "off" && <p className="text-sm text-muted">Usually off: paid a day&apos;s rate.</p>}
        </div>
      )}

      {day.status === "leave" && (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Leave type" className="flex gap-2">
            {LEAVE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={day.leaveType === t.value}
                onClick={() => onChange({ leaveType: t.value })}
                className={`h-10 shrink-0 rounded-full px-3.5 text-sm font-extrabold ${
                  day.leaveType === t.value ? "bg-ink text-mint" : "bg-card text-ink hover:bg-sea-tint"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            aria-label="Reason for leave"
            value={day.note ?? ""}
            maxLength={100}
            onChange={(e) => onChange({ note: e.target.value || null })}
            placeholder="Reason (optional)"
            className="h-12 min-w-0 rounded-xl border-2 border-line bg-card px-3 text-[15px] outline-none focus:border-sea"
          />
        </div>
      )}

      {overtime.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">Overtime</span>
          {overtime.map((o) => (
            <div key={o.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <input
                type="time"
                aria-label="Overtime start"
                value={o.start}
                required
                onChange={(e) => onChangeOvertime(o.key, { start: e.target.value })}
                className="h-12 rounded-xl border-2 border-line bg-card px-3 text-[15px] outline-none focus:border-sea"
              />
              <span aria-hidden="true" className="text-muted">to</span>
              <input
                type="time"
                aria-label="Overtime end"
                value={o.end}
                required
                onChange={(e) => onChangeOvertime(o.key, { end: e.target.value })}
                className="h-12 rounded-xl border-2 border-line bg-card px-3 text-[15px] outline-none focus:border-sea"
              />
              <button
                type="button"
                onClick={() => onRemoveOvertime(o.key)}
                className="h-10 rounded-full px-2.5 text-sm font-extrabold text-coral-text hover:bg-coral-tint"
              >
                Remove
              </button>
              {o.start && o.end && o.start !== o.end && (
                <span className="basis-full text-sm font-bold text-sea">
                  {formatMinutes(overtimeMinutes(o))} × {settings.overtimeRate} · +
                  {formatPeso(overtimeMinutes(o) * perMinute * settings.overtimeRate)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {(!overtimeDay || day.status === "worked") && (
        <button type="button" onClick={onAddOvertime} className="self-start text-sm font-extrabold text-sea-dark hover:underline">
          + Overtime
        </button>
      )}
    </div>
  );
}

/**
 * One cutoff on other dates than usual, and the day it's paid. The cutoffs
 * either side move to meet it; "Back to usual" undoes it.
 */
function CutoffChangeForm({
  period,
  rule,
  payday,
  today,
  onClose,
}: {
  period: Period;
  rule: CutoffRule;
  payday: Schedule;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const usual = usualFor(period, rule);
  const others = (rule.changes ?? []).filter((c) => c.usual !== usual.start);
  const withoutThis: CutoffRule = { ...rule, changes: others };
  const usualNow = cutoffContaining(usual.start, withoutThis);
  const usualPayday = paydayFor(usualNow, payday, withoutThis);
  const current = changeOf(period, rule);
  const [start, setStart] = useState(period.start);
  const [end, setEnd] = useState(period.end);
  const [paidOn, setPaidOn] = useState(current?.paidOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = isValidDate(start) && isValidDate(end);
  const change = { usual: usual.start, start, end, paidOn: paidOn && isValidDate(paidOn) ? paidOn : null };
  const problem = valid ? cutoffChangeProblem(change, rule, today) : "Pick the dates.";
  const withThis: CutoffRule = { ...rule, changes: [...others, change] };
  const next = problem ? null : nextCutoff({ start, end }, withThis);
  const before = problem ? null : previousCutoff({ start, end }, withThis);
  const usualBefore = usualCutoff(addDays(usual.start, -1), rule);
  const usualAfter = usualCutoff(addDays(usual.end, 1), rule);

  function run(action: () => Promise<{ error?: string }>, goTo: string) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else {
        onClose();
        router.replace(`/payroll?cutoff=${goTo}`, { scroll: false });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) setError(problem);
        else run(() => saveCutoffChange(change), start);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-[15px]">
        Usually {formatCutoff(usual, today)}, paid {formatShortDay(usualPayday, today)}.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="change-start" className="text-sm font-bold">Starts</label>
          <input
            id="change-start"
            type="date"
            value={start}
            min={addDays(usualBefore.start, 1)}
            onChange={(e) => setStart(e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="change-end" className="text-sm font-bold">Ends</label>
          <input
            id="change-end"
            type="date"
            value={end}
            max={addDays(usualAfter.end, -1)}
            onChange={(e) => setEnd(e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="change-paid" className="text-sm font-bold">Paid on</label>
          <input id="change-paid" type="date" value={paidOn || usualPayday} onChange={(e) => setPaidOn(e.target.value === usualPayday ? "" : e.target.value)} className={FIELD_CLASS} />
        </div>
      </div>
      <p className="text-sm text-muted">
        {problem
          ? problem
          : [
              before && before.end !== addDays(usual.start, -1) ? `The cutoff before now ends ${formatShortDay(before.end, today)}.` : null,
              next && next.start !== addDays(usual.end, 1)
                ? `The next cutoff starts ${formatShortDay(next.start, today)} instead of ${formatShortDay(addDays(usual.end, 1), today)} (${formatCutoff(next, today)}).`
                : null,
              "No day is lost or counted twice.",
            ]
              .filter(Boolean)
              .join(" ")}
      </p>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : "Save for this cutoff"}
        </button>
        {current && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => removeCutoffChange(usual.start), usual.start)}
            className="h-11 rounded-[14px] px-4 font-extrabold text-sea-dark hover:bg-mint disabled:opacity-60"
          >
            Back to usual
          </button>
        )}
        <button type="button" onClick={onClose} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
          Cancel
        </button>
      </div>
    </form>
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
                {payday.frequency === "twice_monthly" ? (
                  <ContributionDay
                    contribution={c.key}
                    name={c.name}
                    day={days[c.key] ?? RATES.contributionDay}
                    paydays={[payday.day1, payday.day2 ?? RATES.contributionDay]}
                  />
                ) : (
                  <span className="text-xs font-bold text-muted">Due the {ordinal(days[c.key] ?? RATES.contributionDay)}</span>
                )}
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

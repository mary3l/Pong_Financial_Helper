"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePayrollSettings, setEmployment } from "@/app/payroll-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { DayPicker } from "@/components/day-picker";
import {
  PaydayPicker,
  choiceFrom,
  ordinal,
  scheduleFrom,
  type PaydayChoice,
} from "@/components/payday-picker";
import { addDays, formatShortDay } from "@/lib/dates";
import { formatPeso, parseAmount } from "@/lib/money";
import {
  DEFAULT_CUTOFF_WEEKDAY,
  EMPLOYMENTS,
  KINSENA,
  coversText,
  cutoffRuleOf,
  cutoffsPaidOn,
  dailyFromMonthly,
  formatCutoff,
  isEmployee,
  paydayAmounts,
  type Employment,
  type PayrollSettings,
} from "@/lib/payroll";
import { WEEKDAYS, occurrences, type Frequency, type Schedule } from "@/lib/schedule";

type CutoffKind = Exclude<Frequency, "daily">;

const CUTOFF_KINDS: { value: CutoffKind | "daily"; label: string }[] = [
  { value: "twice_monthly", label: "Twice a month" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "daily", label: "Paid by the day" },
];

/** Monday first, Sunday last. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Step 3 of setup: how you earn, your gross pay, your cutoffs, then when
 * you're paid, with each payday's gross worked out. Saves the payroll
 * calculator's settings and payday, so Pay and the forecast use them.
 */
export function PayStep({
  today,
  next,
}: {
  today: string;
  next: { employee: string; other: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [employment, setEmploymentChoice] = useState<Employment | "irregular">("government");
  const [per, setPer] = useState<"month" | "day">("month");
  const [gross, setGross] = useState("");
  const [cutoffKind, setCutoffKind] = useState<CutoffKind | "daily">("twice_monthly");
  // Twice a month: when each cutoff starts. 1 and 16: "1–15 and 16–end".
  const [cutoffDays, setCutoffDays] = useState<[string, string]>([
    String(KINSENA[0]),
    String(KINSENA[1]),
  ]);
  const [cutoffWeekday, setCutoffWeekday] = useState(DEFAULT_CUTOFF_WEEKDAY);
  const [cutoffMonthDay, setCutoffMonthDay] = useState("1");
  const [payday, setPayday] = useState<PaydayChoice>(() => ({
    ...choiceFrom(null, "twice_monthly"),
    twice: [15, 30],
  }));

  const amount = gross.trim() ? parseAmount(gross) : NaN;
  const frequency: Frequency = cutoffKind;
  const choice = { ...payday, kind: frequency };
  const picked = scheduleFrom(choice);

  const settings: PayrollSettings | null =
    amount > 0
      ? {
          dailyRate: per === "month" ? dailyFromMonthly(amount) : amount,
          monthlyPay: per === "month" ? amount : null,
          hoursPerDay: 8,
          startTime: "08:00",
          overtimeRate: 1,
          monthlyBase: null,
          startedOn: null,
          // Self-employed pay their own; employees' offices take them (setEmployment).
          paySss: employment === "self",
          payPhilhealth: employment === "self",
          payPagibig: employment === "self",
          payTax: employment === "self",
          sssAmount: null,
          philhealthAmount: null,
          pagibigAmount: null,
          frequency,
          ...(frequency === "twice_monthly"
            ? {
                cutoffDays: [Number(cutoffDays[0]), Number(cutoffDays[1])].sort(
                  (a, b) => a - b,
                ) as [number, number],
              }
            : {}),
          ...(frequency === "weekly" ? { cutoffWeekday } : {}),
          ...(frequency === "monthly" ? { cutoffMonthDay: Number(cutoffMonthDay) } : {}),
        }
      : null;

  // Your next paydays, gross: what the calculator works out from the above.
  const estimates = (() => {
    if (!settings || !picked.schedule) return [];
    const schedule = picked.schedule as Schedule;
    const rule = cutoffRuleOf(settings);
    const amounts = paydayAmounts(
      { settings, days: [], overtime: [] },
      schedule,
      today,
      addDays(today, 70),
      today,
    );
    return occurrences(schedule, today, addDays(today, 70))
      .slice(0, 3)
      .map((date) => {
        const cutoffs = cutoffsPaidOn(date, schedule, rule);
        return {
          date,
          covers: { start: cutoffs[0].start, end: cutoffs.at(-1)!.end },
          gross: amounts[date]?.amount ?? 0,
        };
      });
  })();

  function save() {
    setError(null);
    if (employment === "irregular") {
      router.push(next.other);
      return;
    }
    if (!settings) {
      setError(`Enter your gross pay per ${per}.`);
      return;
    }
    if (picked.error || !picked.schedule) {
      setError(picked.error ?? "Pick when you get paid.");
      return;
    }
    if (frequency === "twice_monthly" && cutoffDays[0] === cutoffDays[1]) {
      setError("Your two cutoffs start on different days.");
      return;
    }
    const schedule = picked.schedule;
    const how = employment;
    startTransition(async () => {
      const saved = await savePayrollSettings(settings, null, schedule);
      if (saved.error) return setError(saved.error);
      const set = await setEmployment(how);
      if (set.error) return setError(set.error);
      router.push(isEmployee(how) ? next.employee : next.other);
    });
  }

  const section = "flex flex-col gap-3 rounded-[20px] bg-card p-4";
  const chips = <T extends string>(
    labelId: string,
    options: { value: T; label: string }[],
    value: T,
    onPick: (v: T) => void,
  ) => (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <ChoiceChip
          key={o.value}
          selected={value === o.value}
          onClick={() => onPick(o.value)}
          className={value === o.value ? "" : "bg-mint"}
        >
          {o.label}
        </ChoiceChip>
      ))}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      <section className={section}>
        <h2 id="earn-label" className="text-base font-extrabold">
          How do you earn?
        </h2>
        {chips(
          "earn-label",
          [...EMPLOYMENTS, { value: "irregular" as const, label: "No regular pay" }],
          employment,
          setEmploymentChoice,
        )}
      </section>

      {employment !== "irregular" && (
        <>
          <section className={section}>
            <h2 id="gross-label" className="text-base font-extrabold">
              Gross pay
            </h2>
            {chips(
              "gross-label",
              [
                { value: "month" as const, label: "Per month" },
                { value: "day" as const, label: "Per day" },
              ],
              per,
              setPer,
            )}
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted"
              >
                ₱
              </span>
              <AmountInput
                id="gross-pay"
                value={gross}
                onChange={setGross}
                placeholder="0.00"
                aria-label={`Gross pay per ${per}`}
                className={`${FIELD_CLASS} w-full pl-8 text-right`}
              />
            </div>
            <p className="text-[13px] text-muted">Before anything is taken</p>
          </section>

          <section className={section}>
            <h2 id="cutoff-label" className="text-base font-extrabold">
              Cutoff
            </h2>
            {chips("cutoff-label", CUTOFF_KINDS, cutoffKind, (v) => {
              setCutoffKind(v);
              setPayday((p) => ({ ...p, kind: v }));
            })}
            {cutoffKind === "twice_monthly" && (
              <div className="grid grid-cols-2 gap-3">
                <DayPicker
                  id="cutoff-day1"
                  label="1st cutoff starts"
                  value={cutoffDays[0]}
                  onChange={(v) => setCutoffDays([v, cutoffDays[1]])}
                />
                <DayPicker
                  id="cutoff-day2"
                  label="2nd cutoff starts"
                  value={cutoffDays[1]}
                  onChange={(v) => setCutoffDays([cutoffDays[0], v])}
                />
              </div>
            )}
            {cutoffKind === "weekly" && (
              <div className="flex flex-col gap-1">
                <span id="cutoff-weekday-label" className="text-sm font-bold">
                  A cutoff week starts on
                </span>
                {chips(
                  "cutoff-weekday-label",
                  WEEK_ORDER.map((d) => ({ value: String(d), label: WEEKDAYS[d].slice(0, 3) })),
                  String(cutoffWeekday),
                  (v) => setCutoffWeekday(Number(v)),
                )}
              </div>
            )}
            {cutoffKind === "monthly" && (
              <DayPicker
                id="cutoff-month-day"
                label="A cutoff month starts on"
                value={cutoffMonthDay}
                onChange={setCutoffMonthDay}
              />
            )}
            {settings && cutoffKind !== "daily" && (
              <p className="text-[13px] text-muted">
                {coversText(cutoffRuleOf(settings)).replace(/^cutoffs?/, "Cutoffs")}
              </p>
            )}
          </section>

          <section className={section}>
            <h2 id="paid-label" className="text-base font-extrabold">
              How do you get paid?
            </h2>
            <PaydayPicker
              value={choice}
              onChange={setPayday}
              kinds={[frequency]}
              idPrefix="setup-pay"
              labelledBy="paid-label"
            />
            {estimates.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-extrabold">Gross pay · estimates</h3>
                <ul className="flex flex-col rounded-2xl bg-mint px-3 py-1 text-sm">
                  {estimates.map((e) => (
                    <li
                      key={e.date}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line-soft py-2 last:border-0"
                    >
                      <span>
                        <strong>{formatShortDay(e.date, today)}</strong>{" "}
                        <span className="text-muted">
                          pays{" "}
                          {e.covers.start === e.covers.end
                            ? formatShortDay(e.covers.start, today)
                            : formatCutoff(e.covers, today)}
                        </span>
                      </span>
                      <span className="font-bold">{formatPeso(e.gross)}</span>
                    </li>
                  ))}
                </ul>
                <span className="text-xs text-muted">
                  {isEmployee(employment as Employment)
                    ? "Before what your office takes: next step"
                    : "What you're paid; contributions you pay yourself are bills"}
                  {cutoffKind === "monthly" && ` · paid the ${ordinal(choice.monthDay)}`}
                </span>
              </div>
            )}
          </section>
        </>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <p role="alert" className="min-h-5 text-sm font-bold text-coral-text">
          {error}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : "Next"}
        </button>
        <Link
          href={next.other}
          className="flex h-11 items-center justify-center font-extrabold text-sea-dark"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}

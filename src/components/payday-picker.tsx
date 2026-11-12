"use client";

import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { SHORT_WEEKDAYS, WEEKDAYS, WEEKS_OF_MONTH, type Frequency, type Schedule } from "@/lib/schedule";

// "When do you get paid?": the same picker in Settings › Payday and the
// payroll calculator, so both set your payday the same way.

export type PayKind = Frequency | "irregular";

export const PAY_KIND_LABELS: Record<PayKind, string> = {
  daily: "Every work day",
  weekly: "Weekly",
  twice_monthly: "Twice a month",
  monthly: "Monthly",
  irregular: "Irregular",
};

/** Everything the picker holds, for every kind, so switching back keeps what you picked. */
export type PaydayChoice = {
  kind: PayKind;
  /** Twice a month: the two days, in the order picked. */
  twice: [number, number];
  monthDay: number;
  /** Weekly: the weekday. */
  weekday: number;
  /** Weekly: the weeks of the month that pay. */
  weeks: number[];
  /** Every work day: the weekdays you're handed your pay. */
  weekdays: number[];
};

const ALL_WEEKS = [...WEEKS_OF_MONTH];
/** Monday to Friday. */
const WORK_WEEK = [1, 2, 3, 4, 5];
/** Monday first, Sunday last. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

export function dayLabel(day: number): string {
  return day >= 29 ? `${ordinal(day)} (or last day)` : ordinal(day);
}

export function choiceFrom(payday: Schedule | null, fallback: PayKind): PaydayChoice {
  const f = payday?.frequency;
  return {
    kind: f ?? fallback,
    twice: f === "twice_monthly" ? [payday!.day1, payday!.day2!] : [15, 30],
    monthDay: f === "monthly" ? payday!.day1 : 30,
    weekday: f === "weekly" ? payday!.day1 : 5,
    weeks: f === "weekly" && payday!.weeks?.length ? [...payday!.weeks] : ALL_WEEKS,
    weekdays: f === "daily" ? (payday!.weekdays?.length ? [...payday!.weekdays] : [0, 1, 2, 3, 4, 5, 6]) : WORK_WEEK,
  };
}

/**
 * The schedule picked, or why it can't be saved. `order` says which of the
 * two days twice a month came first, so amounts typed per day follow them.
 */
export function scheduleFrom(c: PaydayChoice): { schedule: Schedule | null; order: [number, number]; error?: string } {
  const order: [number, number] = c.twice[0] <= c.twice[1] ? [0, 1] : [1, 0];
  switch (c.kind) {
    case "irregular":
      return { schedule: null, order };
    case "twice_monthly":
      if (c.twice[0] === c.twice[1]) return { schedule: null, order, error: "Pick two different paydays." };
      return { schedule: { frequency: "twice_monthly", day1: c.twice[order[0]], day2: c.twice[order[1]] }, order };
    case "monthly":
      return { schedule: { frequency: "monthly", day1: c.monthDay, day2: null }, order };
    case "weekly": {
      if (!c.weeks.some((w) => w <= 4)) {
        return { schedule: null, order, error: `Pick at least one of the 1st to 4th ${WEEKDAYS[c.weekday]}: the 5th comes only a few times a year.` };
      }
      const weeks = [...c.weeks].sort((a, b) => a - b);
      return { schedule: { frequency: "weekly", day1: c.weekday, day2: null, weeks: weeks.length < ALL_WEEKS.length ? weeks : null }, order };
    }
    case "daily": {
      if (!c.weekdays.length) return { schedule: null, order, error: "Pick the days you're paid." };
      const weekdays = [...c.weekdays].sort((a, b) => a - b);
      return { schedule: { frequency: "daily", day1: weekdays[0], day2: null, weekdays: weekdays.length < 7 ? weekdays : null }, order };
    }
  }
}

function toggle(list: number[], n: number): number[] {
  return list.includes(n) ? list.filter((x) => x !== n) : [...list, n];
}

export function PaydayPicker({
  value,
  onChange,
  kinds,
  idPrefix,
  labelledBy,
}: {
  value: PaydayChoice;
  onChange: (next: PaydayChoice) => void;
  /** Which kinds to offer, in order. */
  kinds: PayKind[];
  idPrefix: string;
  /** The heading the kind chips belong to. */
  labelledBy: string;
}) {
  const set = (patch: Partial<PaydayChoice>) => onChange({ ...value, ...patch });
  const daySelect = (id: string, day: number, onPick: (v: number) => void, label: string) => (
    <div className="flex flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <select id={id} value={day} onChange={(e) => onPick(Number(e.target.value))} className={FIELD_CLASS}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{dayLabel(d)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <ChoiceChip key={k} selected={value.kind === k} onClick={() => set({ kind: k })} className={value.kind === k ? "" : "bg-mint"}>
            {PAY_KIND_LABELS[k]}
          </ChoiceChip>
        ))}
      </div>

      {value.kind === "daily" && (
        <div className="flex flex-col gap-1.5">
          <span id={`${idPrefix}-weekdays`} className="text-sm font-bold">Paid on</span>
          <div role="group" aria-labelledby={`${idPrefix}-weekdays`} className="flex flex-wrap gap-2">
            {WEEK_ORDER.map((d) => (
              <ChoiceChip
                key={d}
                selected={value.weekdays.includes(d)}
                onClick={() => set({ weekdays: toggle(value.weekdays, d) })}
                className={value.weekdays.includes(d) ? "" : "bg-mint"}
              >
                {SHORT_WEEKDAYS[d]}
              </ChoiceChip>
            ))}
          </div>
          <span className="text-xs text-muted">
            {value.weekdays.length
              ? "Each day's pay is handed over that day. A day you work but aren't paid goes with the next payday."
              : "Pick the days you're paid."}
          </span>
        </div>
      )}

      {value.kind === "weekly" && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-weekday`} className="text-sm font-bold">Payday</label>
            <select id={`${idPrefix}-weekday`} value={value.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} className={FIELD_CLASS}>
              {WEEKDAYS.map((name, i) => (
                <option key={name} value={i}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span id={`${idPrefix}-weeks`} className="text-sm font-bold">Which {WEEKDAYS[value.weekday]}s of the month are paydays?</span>
            <div role="group" aria-labelledby={`${idPrefix}-weeks`} className="flex flex-wrap gap-2">
              {WEEKS_OF_MONTH.map((w) => (
                <ChoiceChip
                  key={w}
                  selected={value.weeks.includes(w)}
                  onClick={() => set({ weeks: toggle(value.weeks, w) })}
                  className={value.weeks.includes(w) ? "" : "bg-mint"}
                >
                  {ordinal(w)}
                </ChoiceChip>
              ))}
            </div>
            <span className="text-xs text-muted">
              {value.weeks.length === WEEKS_OF_MONTH.length
                ? `Every ${WEEKDAYS[value.weekday]}. The 5th comes only in some months.`
                : value.weeks.some((w) => w <= 4)
                  ? `Only the ${[...value.weeks].sort((a, b) => a - b).map(ordinal).join(", ")} ${WEEKDAYS[value.weekday]} of the month.`
                  : `Pick at least one of the 1st to 4th ${WEEKDAYS[value.weekday]}: the 5th comes only a few times a year.`}
            </span>
          </div>
        </>
      )}

      {value.kind === "twice_monthly" && (
        <div className="flex gap-3">
          {daySelect(`${idPrefix}-day1`, value.twice[0], (v) => set({ twice: [v, value.twice[1]] }), "First payday")}
          {daySelect(`${idPrefix}-day2`, value.twice[1], (v) => set({ twice: [value.twice[0], v] }), "Second payday")}
        </div>
      )}

      {value.kind === "monthly" && daySelect(`${idPrefix}-month`, value.monthDay, (v) => set({ monthDay: v }), "Payday")}
    </div>
  );
}

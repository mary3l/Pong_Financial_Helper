import type { DayBalance } from "@/lib/forecast";

// Projected balance per day as a step line (balances change on whole days).
// Dashed line at the floor (₱0 unless set), dotted lines on paydays, a dot on the low point.
// `compare` draws a second line, for "Can I afford this?" before vs after.
// No hooks, so it renders on the server and inside client components.

const W = 1000;

export function ForecastChart({
  days,
  compare,
  paydays = [],
  low,
  label,
  height = 140,
  floor = 0,
}: {
  days: DayBalance[];
  compare?: DayBalance[];
  paydays?: string[];
  low?: DayBalance | null;
  /** Read out instead of the drawing. */
  label: string;
  height?: number;
  /** Where the dashed line goes: ₱0, or the payment plan's floor. */
  floor?: number;
}) {
  if (days.length < 2) return null;
  const H = height;
  const values = [...days, ...(compare ?? [])].map((d) => d.balance);
  const min = Math.min(0, floor, ...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  // A little room above the top and below the bottom.
  const top = 10;
  const bottom = 10;
  const x = (i: number) => (i / (days.length - 1)) * W;
  const y = (v: number) => top + (1 - (v - min) / span) * (H - top - bottom);
  const indexOf = new Map(days.map((d, i) => [d.date, i]));

  const step = (series: DayBalance[]) =>
    series
      .map((d, i) => (i === 0 ? `M0 ${y(d.balance)}` : `H${x(i)} V${y(d.balance)}`))
      .join(" ") + ` H${W}`;
  const line = step(days);
  const lowIndex = low ? indexOf.get(low.date) : undefined;

  return (
    <div className="relative" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }} aria-hidden="true">
        <path d={`${line} V${y(min)} H0 Z`} className="fill-sea-tint" />
        {paydays.map((date) =>
          indexOf.has(date) ? (
            <line key={date} x1={x(indexOf.get(date)!)} x2={x(indexOf.get(date)!)} y1={0} y2={H} className="stroke-sun" strokeWidth={2} strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          ) : null,
        )}
        <line x1={0} x2={W} y1={y(floor)} y2={y(floor)} className="stroke-muted" strokeWidth={1.5} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        {compare && (
          <path d={step(compare)} fill="none" className="stroke-coral" strokeWidth={2.5} strokeDasharray="7 5" vectorEffect="non-scaling-stroke" />
        )}
        <path d={line} fill="none" className="stroke-sea" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {lowIndex !== undefined && (
        <span
          aria-hidden="true"
          className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card ${low!.balance < 0 ? "bg-coral" : "bg-ink"}`}
          style={{ left: `${(x(lowIndex) / W) * 100}%`, top: y(low!.balance) }}
        />
      )}
    </div>
  );
}

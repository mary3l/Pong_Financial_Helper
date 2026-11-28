import Link from "next/link";
import { PathIcon } from "@/components/icons";
import { categoryInfo, type UserCategory } from "@/lib/categories";
import { formatShortDay } from "@/lib/dates";
import type { MonthBreakdown } from "@/lib/insights";
import { formatPeso } from "@/lib/money";
import type { Trend } from "@/lib/trend";

// Where this month's money went: a donut of the top 3 categories and Other,
// the top 3 ranked, and each against last month (the same days, while the
// month is running). No hooks, so it renders on the server.

const SLICE_CLASS = ["stroke-slice-1", "stroke-slice-2", "stroke-slice-3"];
const SWATCH_CLASS = ["bg-slice-1", "bg-slice-2", "bg-slice-3"];

const SIZE = 132;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The surface gap between touching slices, in px along the ring. */
const GAP = 2;

export function WhereItWent({
  data,
  custom,
  today,
  activityHref,
}: {
  data: MonthBreakdown;
  custom: UserCategory[];
  today: string;
  /** Activity for one category over the month. */
  activityHref: (key: string) => string;
}) {
  const { month, last, running, total, change, top, slices } = data;
  // "Nov", "Oct": the year shows only when it isn't this year.
  const name = (date: string) => formatShortDay(date, today).replace(/ \d+(,|$)/, "$1");
  const thisMonth = name(month.start);
  const lastMonth = name(last.start);
  const lastSpan = running ? `${lastMonth} 1–${Number(last.end.slice(8))}` : lastMonth;
  const labelOf = (key: string) =>
    key === "other" ? "Other" : categoryInfo("expense", key, custom).label;
  const shareText = (s: { amount: number; share: number }) =>
    s.share === 0 && s.amount > 0 ? "<1%" : `${s.share}%`;

  // Clockwise from the top, biggest first, each slice short by the gap.
  const lengths = slices.map((s) => (s.amount / total) * CIRCUMFERENCE);
  const arcs = slices.map((s, i) => ({
    key: s.key,
    dash: Math.max(0, lengths[i] - (slices.length > 1 ? GAP : 0)),
    // Where it starts: the length of every slice before it.
    offset: lengths.slice(0, i).reduce((sum, l) => sum + l, 0),
    className: s.key === "other" ? "stroke-slice-other" : SLICE_CLASS[i],
    title: `${labelOf(s.key)}: ${formatPeso(s.amount)} (${shareText(s)})`,
  }));

  return (
    <section
      aria-labelledby="where-it-went-heading"
      className="flex flex-col gap-3 rounded-[24px] bg-card p-4 lg:p-5"
    >
      <h2 id="where-it-went-heading" className="font-display text-xl font-semibold">
        Where it went · {thisMonth}
      </h2>

      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg
            role="img"
            aria-label={`${thisMonth} spending: ${arcs.map((a) => a.title).join(", ")}`}
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90"
          >
            {arcs.map((a) => (
              <circle
                key={a.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${a.dash} ${CIRCUMFERENCE}`}
                strokeDashoffset={-a.offset}
                className={a.className}
              >
                <title>{a.title}</title>
              </circle>
            ))}
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-[19px] leading-tight font-semibold">
              {formatPeso(total)}
            </span>
            <span className="text-xs font-bold text-muted">{running ? "so far" : "spent"}</span>
          </span>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
          {slices.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2 text-[15px]">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.key === "other" ? "bg-slice-other" : SWATCH_CLASS[i]}`}
              />
              <span className="min-w-0 flex-1 truncate font-bold">{labelOf(s.key)}</span>
              <span className="shrink-0 font-bold text-muted">{shareText(s)}</span>
            </li>
          ))}
        </ul>
      </div>

      <MonthChange change={change} previous={data.lastTotal} vs={lastSpan} />

      <div className="flex flex-col gap-1 border-t border-line-soft pt-3">
        <h3 className="text-[13px] font-extrabold text-muted">TOP {top.length}</h3>
        <ol className="flex flex-col">
          {top.map((t, i) => {
            const info = categoryInfo("expense", t.key, custom);
            return (
              <li key={t.key}>
                <Link
                  href={activityHref(t.key)}
                  className="flex min-h-14 items-center gap-3 py-1.5 text-ink"
                >
                  <span className="w-4 shrink-0 text-center font-display text-lg font-semibold text-muted">
                    {i + 1}
                  </span>
                  <span
                    className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px] ${info.tint}`}
                  >
                    <PathIcon d={info.icon} size={19} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-bold">{info.label}</span>
                      <span className="shrink-0 font-display text-[17px] font-semibold">
                        {formatPeso(t.current)}
                      </span>
                    </span>
                    <TopChange trend={t} vs={lastMonth} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** "↑ ₱1,200 vs Oct 1–28" for the month as a whole. */
function MonthChange({ change, previous, vs }: { change: number; previous: number; vs: string }) {
  if (previous === 0) return <p className="text-[13px] text-muted">Nothing spent in {vs}</p>;
  if (change === 0) return <p className="text-[13px] text-muted">Same as {vs}</p>;
  const up = change > 0;
  return (
    <p className={`text-[13px] font-bold ${up ? "text-sun-text" : "text-sea-dark"}`}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      <span className="sr-only">{up ? "Up" : "Down"}</span> {formatPeso(Math.abs(change))}{" "}
      <span className="font-normal text-muted">vs {vs}</span>
    </p>
  );
}

/** "↑ ₱800 (+13%) vs Oct", "Same as Oct", or "New · ₱0 in Oct". */
function TopChange({ trend, vs }: { trend: Trend; vs: string }) {
  const { change, percent } = trend;
  if (change === 0) return <span className="text-[13px] text-muted">Same as {vs}</span>;
  if (percent === null) {
    return <span className="text-[13px] font-bold text-sun-text">New · ₱0 in {vs}</span>;
  }
  const up = change > 0;
  return (
    <span className={`text-[13px] font-bold ${up ? "text-sun-text" : "text-sea-dark"}`}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      <span className="sr-only">{up ? "Up" : "Down"}</span> {formatPeso(Math.abs(change))} (
      {up ? "+" : "−"}
      {Math.abs(percent)}%) <span className="font-normal text-muted">vs {vs}</span>
    </span>
  );
}

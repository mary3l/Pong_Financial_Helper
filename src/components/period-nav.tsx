import Link from "next/link";
import { ChevronIcon } from "@/components/icons";
import { formatMonth, formatPeriod, type Period } from "@/lib/dates";
import { periodAfter, periodBefore, periodOf, type Span } from "@/lib/trend";

// Kinsenas | Month, then ‹ the period › — for Activity and Insights. `href`
// builds each page's own link to a period (its first day) and span.

export function PeriodNav({
  span,
  period,
  today,
  href,
}: {
  span: Span;
  period: Period;
  today: string;
  href: (start: string, span: Span) => string;
}) {
  const isCurrent = period.start === periodOf(span, today).start;
  const unit = span === "month" ? "month" : "kinsenas";
  const prev = periodBefore(span, period);
  const next = periodAfter(span, period);
  // Switching keeps the day you're looking at: today if it's in this period.
  const anchor = isCurrent ? today : period.start;
  return (
    <>
      <div
        role="group"
        aria-label="Show by"
        className="grid grid-cols-2 gap-1 rounded-[16px] bg-card p-1"
      >
        {(["kinsenas", "month"] as const).map((s) => (
          <Link
            key={s}
            href={href(periodOf(s, anchor).start, s)}
            aria-current={span === s ? "page" : undefined}
            className={`flex h-10 items-center justify-center rounded-[12px] text-[15px] ${
              span === s ? "bg-sea-tint font-extrabold text-sea-dark" : "font-bold text-muted"
            }`}
          >
            {s === "month" ? "Month" : "Kinsenas"}
          </Link>
        ))}
      </div>

      <nav
        aria-label={span === "month" ? "Month" : "Kinsenas"}
        className="flex items-center justify-between rounded-[20px] bg-card px-2 py-2"
      >
        <Link
          href={href(prev.start, span)}
          aria-label={`Previous ${unit}`}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-mint"
        >
          <ChevronIcon direction="left" size={22} />
        </Link>
        <div className="flex flex-col items-center">
          <span className="font-display text-lg font-semibold">
            {span === "month" ? formatMonth(period.start) : formatPeriod(period, today)}
          </span>
          <span className="text-xs font-bold text-muted">
            {isCurrent ? `This ${unit}` : span === "month" ? "Month" : "Kinsenas"}
          </span>
        </div>
        {next.start <= today ? (
          <Link
            href={href(next.start, span)}
            aria-label={`Next ${unit}`}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-mint"
          >
            <ChevronIcon size={22} />
          </Link>
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        )}
      </nav>
    </>
  );
}

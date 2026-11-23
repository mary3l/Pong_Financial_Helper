import { formatPeso } from "@/lib/money";

// One category's spending per period as small bars, oldest first. Heights are
// scaled to the row's own highest period, so each row shows its ups and downs;
// compare rows by their amounts, not their bars. The last bar is the period
// you're looking at. No hooks, so it renders on the server.

export function TrendBars({
  totals,
  labels,
  height = 28,
}: {
  totals: number[];
  /** Each period's name, for the tooltip and screen readers: "Nov 1 – 15". */
  labels: string[];
  height?: number;
}) {
  const max = Math.max(...totals, 0);
  const summary = totals.map((t, i) => `${labels[i]}: ${formatPeso(t)}`).join(", ");
  return (
    <div
      role="img"
      aria-label={summary}
      className="flex shrink-0 items-end gap-0.5"
      style={{ height }}
    >
      {totals.map((total, i) => {
        const last = i === totals.length - 1;
        // A ₱0 period still shows a stub, so a gap reads as nothing spent.
        const pct = max > 0 && total > 0 ? Math.max(12, (total / max) * 100) : 6;
        return (
          <span
            key={labels[i]}
            title={`${labels[i]}: ${formatPeso(total)}`}
            className={`block w-2.5 rounded-t-[4px] ${last ? "bg-sea" : "bg-muted/45"}`}
            style={{ height: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}

import Link from "next/link";

// Plan = Forecast + Payments + Scheduled + Budgets, as tabs at the top (design
// canvas 3.1, 3.3). Payments is the payment plan; Scheduled holds recurring
// and planned income and expenses.
export function PlanTabs({ current }: { current: "forecast" | "payments" | "scheduled" | "budgets" }) {
  const tabs = [
    { key: "forecast", href: "/plan", label: "Forecast" },
    { key: "payments", href: "/plan/payments", label: "Payments" },
    { key: "scheduled", href: "/plan/scheduled", label: "Scheduled" },
    { key: "budgets", href: "/plan/budgets", label: "Budgets" },
  ] as const;
  return (
    <nav aria-label="Plan" className="flex gap-6 border-b-2 border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={`-mb-0.5 border-b-[3px] py-2 ${
            current === t.key ? "border-sea font-extrabold" : "border-transparent font-bold text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** A row of links that works like a segmented control, e.g. 30 · 60 · 90 days. */
export function SegmentLinks({
  label,
  options,
}: {
  label: string;
  options: { href: string; label: string; current: boolean }[];
}) {
  return (
    <nav
      aria-label={label}
      className="grid gap-1 rounded-2xl bg-card p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          replace
          scroll={false}
          aria-current={o.current ? "page" : undefined}
          className={`flex h-10 items-center justify-center rounded-xl text-sm ${
            o.current ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

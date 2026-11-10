import Link from "next/link";

// Money = Wallets + Savings + Utang & pautang, as tabs at the top (design canvas 4.1, 5.1).
export function MoneyTabs({ current }: { current: "wallets" | "savings" | "people" }) {
  const tabs = [
    { key: "wallets", href: "/money", label: "Wallets" },
    { key: "savings", href: "/money/savings", label: "Savings" },
    { key: "people", href: "/money/people", label: "Utang & pautang" },
  ] as const;
  return (
    <nav aria-label="Money" className="flex gap-5 border-b-2 border-line sm:gap-6">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={`-mb-0.5 shrink-0 border-b-[3px] py-2 ${
            current === t.key ? "border-sea font-extrabold" : "border-transparent font-bold text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

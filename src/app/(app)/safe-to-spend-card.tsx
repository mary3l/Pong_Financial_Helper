import Link from "next/link";
import { Pong, type PongMood } from "@/components/pong";
import { addDays, formatShortDay } from "@/lib/dates";
import { formatPeso } from "@/lib/money";
import { PLAN_DAYS, PLAN_FLOOR, type PlanToday } from "@/lib/payment-plan";

// Home's Safe to spend card (design canvas 2.1), with Pong in the corner
// saying how it's going. The amount is this week's pool from the payment
// plan (weekPlan): spend it over the week however you like. Cash only; BNPL
// has its own cap on each bill.

export type PongLine = { mood: PongMood; message: string; link?: { href: string; label: string } };

export function SafeToSpendCard({
  day,
  pong,
  limitLeft,
  setAside,
  today,
}: {
  day: PlanToday;
  /** What Pong says about it, with his face to match. */
  pong: PongLine;
  /** What's left of every BNPL limit together. */
  limitLeft: number;
  setAside: number;
  today: string;
}) {
  const { week } = day;
  const { left, spent } = week;
  // Each line's cap on the bill today's buys land on.
  const current = day.caps.filter((c) => c.from <= today && today < c.until);
  const amount = formatPeso(left);
  // Pong sits beside the amount, so longer amounts get a smaller size instead of running under him.
  const amountSize =
    amount.length <= 5
      ? "text-[2.75rem] sm:text-5xl"
      : amount.length <= 8
        ? "text-[2.25rem] sm:text-[2.6rem]"
        : "text-[1.6rem] sm:text-[2rem]";
  const scale = Math.max(week.pool, spent) || 1;
  // What this week has to spend: the pool, less anything bills ahead need back.
  const budget = week.pool - week.heldForBills;
  return (
    <section className="relative flex flex-col gap-1.5 overflow-hidden rounded-[28px] bg-sea p-6 text-white lg:p-7">
      <div
        aria-hidden="true"
        className="absolute -top-12 -right-10 h-40 w-40 rounded-full bg-sea-light"
      />
      <div className="relative flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-sm font-bold text-sea-text">LEFT THIS WEEK</h2>
          <p
            className={`font-display leading-none font-semibold whitespace-nowrap ${amountSize} ${left < 0 ? "text-sun" : ""}`}
          >
            {amount}
          </p>
          {/* Over: nothing left to spread, and the Over by tag says it. */}
          {left >= 0 && (
            <p className="text-[15px] leading-snug font-extrabold">
              {formatPeso(week.pace)}/day ·{" "}
              {week.daysLeft === 1 ? "last day" : `${week.daysLeft} days`}
            </p>
          )}
          {/* The week's budget: its daily amount when every day gets the same one. */}
          <p className="text-[15px] leading-snug text-sea-text">
            Budget{" "}
            {week.budgetPerDay !== null && week.heldForBills === 0
              ? `${formatPeso(week.budgetPerDay)}/day · ${formatPeso(budget)} this week`
              : `${formatPeso(budget)} this week`}
          </p>
          {spent > 0 && (
            <>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-snug text-sea-text">
                <span>Spent {formatPeso(spent)}</span>
                {left < 0 && (
                  <span className="rounded-full bg-sun px-2 py-0.5 text-xs font-extrabold text-ink">
                    Over by {formatPeso(-left)}
                  </span>
                )}
              </p>
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-2.5 overflow-hidden rounded-full bg-sea-deep"
              >
                <span
                  className={`block h-full ${left < 0 ? "bg-sun" : "bg-sea-text"}`}
                  style={{ width: `${(spent / scale) * 100}%` }}
                />
              </span>
            </>
          )}
        </div>
        <Pong
          mood={pong.mood}
          size={84}
          className="pong-peek -mt-1 -mr-2 shrink-0 drop-shadow-[0_3px_0_rgba(0,0,0,0.18)]"
        />
      </div>
      {pong.message && (
        <p className="relative mt-1 rounded-[18px_6px_18px_18px] bg-sea-deep/60 px-3.5 py-2.5 text-[15px] leading-snug text-sea-text">
          {pong.message}
          {pong.link && (
            <>
              {" "}
              <Link
                href={pong.link.href}
                className="font-extrabold text-white underline underline-offset-4"
              >
                {pong.link.label}
              </Link>
            </>
          )}
        </p>
      )}
      {current.length > 0 && (
        <div className="relative mt-1.5 flex flex-col gap-2 border-t border-dashed border-sea-light pt-3">
          <h3 className="text-[13px] font-bold text-sea-text">BNPL CAP · THIS BILL</h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {current.map((c) => (
              <li key={c.lineId} className="flex flex-col rounded-[14px] bg-sea-deep px-3 py-2">
                <span className="text-xs font-extrabold text-sea-text">{c.name}</span>
                <span className="font-display text-lg font-semibold">
                  {c.left > 0 ? `Up to ${formatPeso(c.left)}` : "None"}
                </span>
                <span className="text-[11px] text-sea-text">
                  {formatPeso(c.used)} of {formatPeso(c.cap)} · bill {formatShortDay(c.due, today)}
                </span>
              </li>
            ))}
          </ul>
          {limitLeft > 0 && (
            <p className="text-xs text-sea-text">Limit left {formatPeso(limitLeft)}</p>
          )}
        </div>
      )}
      <details className="group relative">
        <summary className="flex h-11 w-fit cursor-pointer list-none items-center text-[15px] font-extrabold text-white underline underline-offset-4 [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">How is this computed?</span>
          <span className="hidden group-open:inline">Hide breakdown</span>
        </summary>
        <dl className="flex flex-col gap-1.5 rounded-[18px] bg-sea-deep px-4 py-3.5 text-[15px]">
          <BreakdownLine
            label={`This week · ${formatShortDay(week.from, today)}–${formatShortDay(addDays(week.until, -1), today)}`}
            value={formatPeso(week.pool)}
          />
          {week.heldForBills > 0 && (
            <BreakdownLine label="− Held for bills" value={formatPeso(week.heldForBills)} />
          )}
          <BreakdownLine label="− Spent this week" value={formatPeso(spent)} />
          <BreakdownLine label="= Left" value={formatPeso(left)} strong divider />
          <BreakdownLine
            label={`÷ ${week.daysLeft} ${week.daysLeft === 1 ? "day" : "days"}`}
            value={`${formatPeso(week.pace)}/day`}
          />
          <BreakdownLine label="Always keep" value={formatPeso(PLAN_FLOOR)} divider />
        </dl>
        <p className="pt-2 text-[13px] leading-snug text-sea-text">
          Every bill, loan, BNPL bill and payday in the next {PLAN_DAYS} days counts, and what you
          usually put on BNPL is held on its bill day.
          {setAside > 0 && <> Your {formatPeso(setAside)} in savings doesn&apos;t.</>}{" "}
          <Link
            href="/plan/payments"
            className="font-extrabold text-white underline underline-offset-4"
          >
            Payments
          </Link>
        </p>
      </details>
    </section>
  );
}

function BreakdownLine({
  label,
  value,
  strong = false,
  divider = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 ${strong ? "font-extrabold" : ""} ${divider ? "border-t border-sea-light pt-1.5" : ""}`}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function pongSays(
  day: PlanToday,
  { hasWallets, hasPayday }: { hasWallets: boolean; hasPayday: boolean },
): PongLine {
  if (!hasWallets) {
    return {
      mood: "ask",
      message:
        "Add your wallets and payday, and I'll work out how much you can safely spend each day.",
      link: { href: "/setup", label: "Set up wallets" },
    };
  }
  const { plan, week } = day;
  if (!hasPayday && week.spent === 0) {
    return {
      mood: "listen",
      message: "When's payday? Tell me and I'll plan around it.",
      link: { href: "/settings/payday", label: "Set payday" },
    };
  }
  if (plan.short) {
    return {
      mood: "worried",
      message: "Bills ahead need more than you have. Let's go easy.",
      link: { href: "/plan/payments", label: "See payments" },
    };
  }
  // Nothing spent this week yet: the amount says it all, so no bubble.
  if (week.spent === 0) return { mood: "peek", message: "" };
  // Over: the card's Over by tag already says it, so Pong just looks worried.
  if (week.left < 0) return { mood: "worried", message: "" };
  if (week.left === 0) return { mood: "listen", message: "This week's used up · new week Monday" };
  if (week.pace < plan.perDay / 2)
    return { mood: "listen", message: `Go easy · ${formatPeso(week.pace)} a day till Sunday` };
  return { mood: "happy", message: "On track this week" };
}

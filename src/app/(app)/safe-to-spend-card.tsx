import Link from "next/link";
import { Pong, type PongMood } from "@/components/pong";
import { DEBT_SHARE, SURPLUS_SHARE, totalUsable, type BnplCap, type CreditRoom } from "@/lib/bnpl";
import { formatShortDay } from "@/lib/dates";
import type { SafeToSpend } from "@/lib/forecast";
import { formatPeso, roundCents } from "@/lib/money";

// Home's Safe to spend card (design canvas 2.1), with Pong (shell and all)
// in the corner saying how it's going, its breakdown, and BNPL you can still use.

export type PongLine = { mood: PongMood; message: string; link?: { href: string; label: string } };

export function SafeToSpendCard({
  sts,
  pong,
  setAside,
  credit,
  cap,
  today,
}: {
  sts: SafeToSpend;
  /** What Pong says about it, with his face to match. */
  pong: PongLine;
  setAside: number;
  /** BNPL lines: shown apart, never in the numbers above them. */
  credit: CreditRoom[];
  /** Pong's monthly BNPL cap; null without credit lines. */
  cap: BnplCap | null;
  today: string;
}) {
  const hasPayday = sts.perDay !== null && sts.nextPayday;
  // Something to show: a limit, or a cap (or a pause) that holds every line.
  const amount = formatPeso(hasPayday ? sts.leftToday! : sts.inWallets);
  // Pong sits beside the amount, so longer amounts get a smaller size instead of running under him.
  const amountSize =
    amount.length <= 5
      ? "text-[2.75rem] sm:text-5xl"
      : amount.length <= 8
        ? "text-[2.25rem] sm:text-[2.6rem]"
        : "text-[1.6rem] sm:text-[2rem]";
  const showCredit = cap !== null && (cap.left !== null || credit.some((l) => l.creditLeft !== null));
  return (
    <section className="relative flex flex-col gap-1.5 overflow-hidden rounded-[28px] bg-sea p-6 text-white lg:p-7">
      <div aria-hidden="true" className="absolute -top-12 -right-10 h-40 w-40 rounded-full bg-sea-light" />
      {/* The amount with Pong beside it; his bubble runs the full width under them. */}
      <div className="relative flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-sm font-bold text-sea-text">{hasPayday ? "SAFE TO SPEND TODAY" : "IN YOUR WALLETS"}</h2>
          <p className={`font-display leading-none font-semibold whitespace-nowrap ${amountSize}`}>{amount}</p>
          {hasPayday && sts.spentToday > 0 && (
            <p className="text-[15px] leading-snug font-extrabold">
              {sts.leftToday! < 0
                ? `Over by ${formatPeso(-sts.leftToday!)}: spent ${formatPeso(sts.spentToday)} of ${formatPeso(sts.perDay!)} today`
                : `Spent ${formatPeso(sts.spentToday)} of today's ${formatPeso(sts.perDay!)}`}
            </p>
          )}
        </div>
        <Pong mood={pong.mood} size={84} className="pong-peek -mt-1 -mr-2 shrink-0 drop-shadow-[0_3px_0_rgba(0,0,0,0.18)]" />
      </div>
      <p className="relative mt-1 rounded-[18px_6px_18px_18px] bg-sea-deep/60 px-3.5 py-2.5 text-[15px] leading-snug text-sea-text">
        {pong.message}
        {pong.link && (
          <>
            {" "}
            <Link href={pong.link.href} className="font-extrabold text-white underline underline-offset-4">
              {pong.link.label}
            </Link>
          </>
        )}
      </p>
      {showCredit && <CreditAvailable lines={credit} cap={cap} />}
      {hasPayday && (
        <details className="group relative">
          <summary className="flex h-11 w-fit cursor-pointer list-none items-center text-[15px] font-extrabold text-white underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">How is this computed?</span>
            <span className="hidden group-open:inline">Hide breakdown</span>
          </summary>
          <dl className="flex flex-col gap-1.5 rounded-[18px] bg-sea-deep px-4 py-3.5 text-[15px]">
            <BreakdownLine
              label={sts.spentToday > 0 ? "Spending money in your wallets this morning" : "Spending money in your wallets"}
              value={formatPeso(roundCents(sts.inWallets + sts.spentToday))}
            />
            <BreakdownLine label={`− Due before payday (${sts.dueCount})`} value={formatPeso(sts.dueBeforePayday)} />
            {sts.setAsideLater > 0 && (
              <BreakdownLine label="− Held back for bills your next pays can't cover" value={formatPeso(sts.setAsideLater)} />
            )}
            <BreakdownLine
              label={`= Free until ${formatShortDay(sts.nextPayday!, today)}`}
              value={formatPeso(sts.free)}
              strong
              divider
            />
            <BreakdownLine
              label={`÷ ${sts.daysLeft} ${sts.daysLeft === 1 ? "day" : "days"}`}
              value={`${formatPeso(sts.perDay!)} / day`}
              strong
            />
            <BreakdownLine label="− Spent today" value={formatPeso(sts.spentToday)} />
            <BreakdownLine label="= Left for today" value={formatPeso(sts.leftToday!)} strong divider />
          </dl>
          <p className="pt-2 text-[13px] leading-snug text-sea-text">
            Only spending money in cash, bank and e-wallets counts
            {setAside > 0 && <> (your {formatPeso(setAside)} in savings, emergency fund and investments doesn&apos;t)</>}.
            Pautang, credit limits and loans never do,
            and neither does income you haven&apos;t received yet.
            {sts.setAsideLater > 0 && (
              <>
                {" "}With pay every week, I look a month ahead: if the pays coming before a bill
                can&apos;t cover it, part of it is held back from today so you&apos;re not short on the day.
              </>
            )}{" "}
            A bill stops counting once
            you mark it paid. What you spend today comes out of today&apos;s share; paying a
            scheduled bill doesn&apos;t, since it was already set aside.
          </p>
          {cap && <CreditBreakdown lines={credit} cap={cap} />}
        </details>
      )}
    </section>
  );
}

/** Borrowed money you could still use: apart from, and quieter than, your own. */
function CreditAvailable({ lines, cap }: { lines: CreditRoom[]; cap: BnplCap }) {
  return (
    <div className="relative mt-1.5 flex flex-col gap-0.5 border-t border-dashed border-sea-light pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-bold text-sea-text">BNPL YOU CAN STILL USE</h3>
        <span className="font-display text-2xl font-semibold">{formatPeso(totalUsable(lines, cap.left))}</span>
      </div>
      <p className="text-[13px] leading-snug text-sea-text">
        {cap.status === "set" && (
          <>
            Borrowed · my cap this month {formatPeso(cap.cap!)}
            {cap.used > 0 && <>, {formatPeso(cap.used)} used</>}
          </>
        )}
        {cap.status === "paused" && <>Paused: {cap.reason}</>}
        {cap.status === "unknown" && <>Borrowed, you pay it back later. {cap.reason}</>}
      </p>
    </div>
  );
}

function CreditBreakdown({ lines, cap }: { lines: CreditRoom[]; cap: BnplCap }) {
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  return (
    <>
      <h3 className="pt-4 pb-1.5 text-[13px] font-extrabold text-sea-text">BNPL · NOT IN THE NUMBERS ABOVE</h3>
      {cap.months > 0 && cap.income > 0 && (
        <dl className="mb-2 flex flex-col gap-1.5 rounded-[18px] bg-sea-deep px-4 py-3.5 text-[15px]">
          <BreakdownLine
            label={
              cap.estimated
                ? "Take-home a month (your pay in the next 30 days)"
                : `Take-home a month (last ${cap.months} ${cap.months === 1 ? "month" : "months"})`
            }
            value={formatPeso(cap.income)}
          />
          <BreakdownLine
            label={cap.estimated ? "− Spending a month (bills + this month's daily rate)" : "− Spending a month"}
            value={formatPeso(cap.spending)}
          />
          <BreakdownLine label="= Left after spending" value={formatPeso(cap.surplus)} strong divider />
          <BreakdownLine
            label={`All BNPL and loan payments: the smaller of ${percent(DEBT_SHARE)} of take-home (${formatPeso(cap.byIncome)}) and ${percent(SURPLUS_SHARE)} of what's left (${formatPeso(cap.bySurplus)})`}
            value={formatPeso(cap.ceiling)}
            strong
            divider
          />
          <BreakdownLine label="− Installments and loans due in 30 days" value={formatPeso(cap.debtPayments)} />
          <BreakdownLine label="= My cap on new BNPL this month" value={formatPeso(cap.cap!)} strong divider />
          <BreakdownLine label="− Charged to BNPL this month" value={formatPeso(cap.used)} />
          <BreakdownLine label="= Left this month" value={formatPeso(cap.left!)} strong divider />
        </dl>
      )}
      <dl className="flex flex-col gap-2 rounded-[18px] bg-sea-deep px-4 py-3.5 text-[15px]">
        {lines.map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-3">
            <dt className="flex flex-col">
              <span className="font-extrabold">{l.name}</span>
              <span className="text-[13px] text-sea-text">
                {l.limit === null
                  ? `You owe ${formatPeso(l.owed)}`
                  : `${formatPeso(l.limit)} limit − ${formatPeso(l.owed)} you owe`}
              </span>
            </dt>
            <dd className="text-right font-extrabold">
              {l.creditLeft === null ? (
                <Link href={`/money/${l.id}`} className="text-white underline underline-offset-4">
                  Set a limit
                </Link>
              ) : (
                `${formatPeso(l.creditLeft)} left`
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="pt-2 text-[13px] leading-snug text-sea-text">
        {cap.status === "unknown" ? (
          <>{cap.reason} </>
        ) : (
          <>
            {cap.status === "paused" && <>{cap.reason} </>}
            You can use what&apos;s left of your limits, but never more than my cap. I work it out
            again every day from your income, spending and installments, so each BNPL purchase
            lowers next month&apos;s cap.{" "}
            {cap.estimated && <>Until you have a full month of records, it&apos;s an estimate. </>}
          </>
        )}
        What you buy with BNPL doesn&apos;t come out of today&apos;s share. Its payments do, once
        they&apos;re due before payday.
      </p>
    </>
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
    <div className={`flex justify-between gap-3 ${strong ? "font-extrabold" : ""} ${divider ? "border-t border-sea-light pt-1.5" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function pongSays(sts: SafeToSpend, hasWallets: boolean, today: string): PongLine {
  if (!hasWallets) {
    return {
      mood: "ask",
      message: "Add your wallets and payday, and I'll work out how much you can safely spend each day.",
      link: { href: "/setup", label: "Set up wallets" },
    };
  }
  if (!sts.nextPayday || sts.perDay === null || sts.daysLeft === null) {
    return {
      mood: "listen",
      message: "When's payday? Tell me and I'll spread your money across the days until then.",
      link: { href: "/settings/payday", label: "Set payday" },
    };
  }
  const payday = formatShortDay(sts.nextPayday, today);
  const days = `${sts.daysLeft} ${sts.daysLeft === 1 ? "day" : "days"} left`;
  if (sts.perDay === 0) {
    return {
      mood: "worried",
      message: `What's due before payday is more than what's in your wallets. Let's go easy until ${payday}.`,
      link: { href: "/plan", label: "See forecast" },
    };
  }
  if (sts.leftToday !== null && sts.leftToday < 0) {
    return {
      mood: "worried",
      message: `You went ${formatPeso(-sts.leftToday)} over today. It's okay, let's take it easy tomorrow. Payday's ${payday}, ${days}.`,
    };
  }
  if (sts.daysLeft === 1) {
    return { mood: "proud", message: `Payday's tomorrow! ${formatPeso(sts.perDay)} for today and you made it, kaya natin 'to.` };
  }
  return {
    mood: sts.spentToday > 0 ? "happy" : "peek",
    message: `${formatPeso(sts.perDay)} a day until payday on ${payday}, ${days}. Stay under it and you're set!`,
  };
}

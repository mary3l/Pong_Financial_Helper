import Link from "next/link";
import { ChevronIcon, PathIcon } from "@/components/icons";
import { Pong, type PongMood } from "@/components/pong";
import { categoryInfo, type UserCategory } from "@/lib/categories";
import { formatShortDay } from "@/lib/dates";
import {
  elapsedShare,
  type BudgetPace,
  type Frequent,
  type Goal,
  type GoalProgress,
  type PaydayEffect,
  type Suggestion,
  type Summary,
  type WeekendSplit,
} from "@/lib/insights";
import { formatPeso } from "@/lib/money";
import type { CategoryTrend, Trend } from "@/lib/trend";
import { RemoveGoalButton, SetBudgetButton } from "./goal-controls";

// The sections of Insights: the summary, your goals, what you can adjust,
// budgets and habits, then each category. Server components, given everything
// already worked out (lib/insights.ts).

/** "Transpo › Grab", or "Transpo". */
export type Labeler = (key: string, sub?: string | null) => string;

const pct = (share: number) => `${Math.round(share * 100)}%`;

function Section({
  id,
  title,
  note,
  children,
}: {
  id?: string;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  // "What you can adjust" → "what-you-can-adjust-heading": ids can't have spaces.
  const headingId = `${id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-heading`;
  return (
    <section aria-labelledby={headingId} id={id} className="flex scroll-mt-4 flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="font-display text-xl font-semibold">
          {title}
        </h2>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

// ── Summary ─────────────────────────────────────────────────────────────

export function SummaryCard({
  summary,
  label,
  unit,
  isCurrent,
}: {
  summary: Summary;
  label: Labeler;
  unit: string;
  isCurrent: boolean;
}) {
  const { spent, usual, diff, ups, down } = summary;
  // Within 5% of usual reads as usual.
  const near = usual !== null && diff !== null && Math.abs(diff) <= usual * 0.05;
  const mood: PongMood =
    usual === null ? "listen" : near ? "happy" : diff! > 0 ? "worried" : "proud";
  const byNow = isCurrent ? " by this point" : "";
  return (
    <section
      aria-label="Summary"
      className="relative flex flex-col gap-2 overflow-hidden rounded-[28px] bg-sea p-5 text-white lg:p-6"
    >
      <div
        aria-hidden="true"
        className="absolute -top-12 -right-10 h-36 w-36 rounded-full bg-sea-light"
      />
      <div className="relative flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-sm font-bold text-sea-text">
            SPENT {isCurrent ? `THIS ${unit.toUpperCase()} SO FAR` : `THIS ${unit.toUpperCase()}`}
          </h2>
          <p className="font-display text-[2.25rem] leading-none font-semibold">
            {formatPeso(spent)}
          </p>
          <p className="text-[15px] leading-snug font-extrabold">
            {usual === null
              ? "Not enough history yet to know your usual. Keep logging!"
              : near
                ? `About your usual${byNow} (${formatPeso(usual)})`
                : diff! > 0
                  ? `${formatPeso(diff!)} more than usual${byNow}`
                  : `${formatPeso(-diff!)} less than usual${byNow}`}
          </p>
        </div>
        <Pong mood={mood} size={76} className="pong-peek -mt-1 -mr-1 shrink-0" />
      </div>
      {(ups.length > 0 || down) && (
        <ul className="relative flex flex-col gap-1.5 rounded-[18px] bg-sea-deep/60 px-4 py-3 text-[15px] leading-snug text-sea-text">
          {ups.length > 0 && (
            <li>
              <b className="text-white">Up most:</b>{" "}
              {ups.map((u, i) => (
                <span key={u.key}>
                  {i > 0 && ", "}
                  {label(u.key, u.sub)} (+{formatPeso(u.diff)})
                </span>
              ))}
            </li>
          )}
          {down && (
            <li>
              <b className="text-white">Down most:</b> {label(down.key, down.sub)} (−
              {formatPeso(-down.diff)})
            </li>
          )}
        </ul>
      )}
      <p className="relative text-[13px] text-sea-text">
        Usual: your average {unit} before this one{isCurrent ? ", up to this point" : ""}.
      </p>
    </section>
  );
}

// ── Goals ───────────────────────────────────────────────────────────────

const GOAL_TEXT: Record<GoalProgress["status"], { mood: PongMood; tone: string }> = {
  on_track: { mood: "happy", tone: "text-sea-dark" },
  at_risk: { mood: "worried", tone: "text-sun-text" },
  over: { mood: "shocked", tone: "text-coral-text" },
  met: { mood: "proud", tone: "text-sea-dark" },
  missed: { mood: "sleepy", tone: "text-coral-text" },
};

function goalLine(goal: Goal, p: GoalProgress): string {
  const days = `${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"}`;
  switch (p.status) {
    case "on_track":
      return `On track · ${formatPeso(p.perDayLeft)} a day for ${days}`;
    case "at_risk":
      return `Ahead of pace · keep it to ${formatPeso(p.perDayLeft)} a day for ${days}`;
    case "over":
      return `Over by ${formatPeso(p.spent - goal.limit)}`;
    case "met":
      return `Done! You stayed ${formatPeso(goal.limit - p.spent)} under`;
    case "missed":
      return `Missed by ${formatPeso(p.spent - goal.limit)} · try a goal a little higher next time`;
  }
}

export function GoalsSection({
  goals,
  label,
  today,
  missing,
  children,
}: {
  goals: { goal: Goal; progress: GoalProgress }[];
  label: Labeler;
  today: string;
  /** Migration 0028 isn't run yet. */
  missing: boolean;
  /** The new goal form. */
  children: React.ReactNode;
}) {
  return (
    <Section
      id="goals"
      title="Your goals"
      note="Spend under an amount on one category until a day you pick."
    >
      {missing ? (
        <p className="rounded-[20px] bg-card px-4 py-3 text-[15px] text-muted">
          To save goals, run step 28 in <code>supabase/SQL_GUIDE.md</code> first.
        </p>
      ) : (
        <>
          {goals.length > 0 && (
            <ul className="flex flex-col gap-2">
              {goals.map(({ goal, progress }) => {
                const name = label(goal.category, goal.subcategory);
                const { mood, tone } = GOAL_TEXT[progress.status];
                const used = Math.min(1, progress.spent / goal.limit);
                const ended = progress.daysLeft === 0;
                const pace = elapsedShare({ start: goal.startsOn, end: goal.endsOn }, today);
                return (
                  <li
                    key={goal.id}
                    className="flex flex-col gap-2 rounded-[20px] bg-card px-4 py-3.5"
                  >
                    <div className="flex items-start gap-3">
                      <Pong mood={mood} size={44} decorative className="shrink-0" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-bold">
                          Under {formatPeso(goal.limit)} on {name}
                        </span>
                        <span className="text-[13px] text-muted">
                          {ended ? "Ended" : "Until"} {formatShortDay(goal.endsOn, today)} ·{" "}
                          {formatPeso(progress.spent)} spent
                        </span>
                      </div>
                      <RemoveGoalButton id={goal.id} label={`the ${name} goal`} />
                    </div>
                    <div
                      role="img"
                      aria-label={`${formatPeso(progress.spent)} of ${formatPeso(goal.limit)}`}
                      className="relative h-2.5 overflow-hidden rounded-full bg-line-soft"
                    >
                      <span
                        className={`block h-full rounded-full ${
                          progress.status === "over" || progress.status === "missed"
                            ? "bg-coral"
                            : progress.status === "at_risk"
                              ? "bg-sun"
                              : "bg-sea"
                        }`}
                        style={{ width: `${used * 100}%` }}
                      />
                      {!ended && (
                        // Where an even pace would be today.
                        <span
                          aria-hidden="true"
                          className="absolute top-0 h-full w-0.5 bg-ink/50"
                          style={{ left: `${pace * 100}%` }}
                        />
                      )}
                    </div>
                    <p className={`text-[13px] font-bold ${tone}`}>{goalLine(goal, progress)}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {children}
        </>
      )}
    </Section>
  );
}

// ── What you can adjust ─────────────────────────────────────────────────

/** Ideas shown before "Show more": the rest fold away so the page stays calm. */
const ADJUST_SHOWN = 2;

export function AdjustSection({
  items,
  label,
  unit,
  goalHref,
}: {
  items: Suggestion[];
  label: Labeler;
  unit: string;
  /** Opens the new goal form filled in from a suggestion. */
  goalHref: (s: Extract<Suggestion, { goal: unknown }>) => string;
}) {
  const row = (s: Suggestion) => (
    <li
      key={`${s.kind}-${s.key}-${"sub" in s ? s.sub : ""}`}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[20px] bg-card px-4 py-3"
    >
      <p className="min-w-0 flex-1 basis-56 text-[15px] leading-snug">
        {s.kind === "fewer" && (
          <>
            <b>{label(s.key, s.sub)}</b> 2 fewer times a week saves about{" "}
            <b className="text-sea-dark">{formatPeso(s.saves)} a month</b>
            <span className="text-muted"> · now about {s.perWeek}× a week</span>
          </>
        )}
        {s.kind === "usual" && (
          <>
            <b>{label(s.key, s.sub)}</b> is <b className="text-sea-dark">{formatPeso(s.over)}</b>{" "}
            over your usual {formatPeso(s.usual)} a {unit}
          </>
        )}
        {s.kind === "budget" && (
          <>
            <b>{label(s.key)}</b> has no budget. You usually spend {formatPeso(s.usual)} a kinsenas;
            a {formatPeso(s.amount)} budget lets me warn you before it runs over.
          </>
        )}
      </p>
      {s.kind === "budget" ? (
        <SetBudgetButton category={s.key} amount={s.amount} label={label(s.key)} />
      ) : (
        <Link
          href={goalHref(s)}
          className="flex h-10 shrink-0 items-center rounded-full border-2 border-line px-3.5 text-sm font-extrabold text-ink hover:bg-sea-tint"
        >
          Make it a goal
        </Link>
      )}
    </li>
  );
  const rest = items.slice(ADJUST_SHOWN);
  return (
    <Section title="What you can adjust" note="Small changes, from your own spending.">
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.slice(0, ADJUST_SHOWN).map(row)}
          {rest.length > 0 && (
            <li>
              <details className="group">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 px-1 text-sm font-extrabold text-sea-dark [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">
                    Show {rest.length} more {rest.length === 1 ? "idea" : "ideas"}
                  </span>
                  <span className="hidden group-open:inline">Show fewer</span>
                </summary>
                <ul className="flex flex-col gap-2">{rest.map(row)}</ul>
              </details>
            </li>
          )}
        </ul>
      ) : (
        <p className="rounded-[20px] bg-card px-4 py-3 text-[15px] text-muted">
          Nothing stands out: you&apos;re spending like you usually do.
        </p>
      )}
    </Section>
  );
}

// ── Budgets ─────────────────────────────────────────────────────────────

const PACE: Record<BudgetPace["status"], { text: string; tone: string; bar: string }> = {
  over: { text: "Over", tone: "bg-coral-tint text-coral-text", bar: "bg-coral" },
  ahead: { text: "Ahead of pace", tone: "bg-sun-tint text-sun-text", bar: "bg-sun" },
  on_pace: { text: "On pace", tone: "bg-sea-tint text-sea-dark", bar: "bg-sea" },
};

export function BudgetSection({ items, label }: { items: BudgetPace[]; label: Labeler }) {
  return (
    <Section
      title="Budgets"
      note={
        <>
          The line is where you&apos;d be spending evenly.{" "}
          <Link href="/plan/budgets" className="font-extrabold text-sea-dark underline">
            Change budgets
          </Link>
        </>
      }
    >
      <ul className="flex flex-col gap-3 rounded-[20px] bg-card px-4 py-3.5">
        {items.map((b) => (
          <li key={b.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-bold">{label(b.key)}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-extrabold ${PACE[b.status].tone}`}
              >
                {PACE[b.status].text}
              </span>
            </div>
            <div
              role="img"
              aria-label={`${formatPeso(b.spent)} of ${formatPeso(b.limit)}`}
              className="relative h-2.5 overflow-hidden rounded-full bg-line-soft"
            >
              <span
                className={`block h-full rounded-full ${PACE[b.status].bar}`}
                style={{ width: `${Math.min(1, b.spent / b.limit) * 100}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute top-0 h-full w-0.5 bg-ink/50"
                style={{ left: `${Math.min(1, b.expected / b.limit) * 100}%` }}
              />
            </div>
            <span className="text-[13px] text-muted">
              {formatPeso(b.spent)} of {formatPeso(b.limit)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── Habits ──────────────────────────────────────────────────────────────

export function HabitsSection({
  payday,
  weekend,
  frequent,
  label,
  activityHref,
  windowNote,
}: {
  payday: PaydayEffect | null;
  weekend: WeekendSplit | null;
  frequent: Frequent[];
  label: Labeler;
  activityHref: (key: string, sub: string | null) => string;
  /** "the last 3 months", what the habits are measured over. */
  windowNote: string;
}) {
  const habits: { title: string; text: React.ReactNode; tip?: string }[] = [];

  if (payday) {
    const splurge = payday.spendShare >= payday.dayShare * 1.3;
    habits.push(
      splurge
        ? {
            title: "Payday splurge",
            text: (
              <>
                <b>{pct(payday.spendShare)}</b> of your spending happens on payday and the 2 days
                after, though they&apos;re only {pct(payday.dayShare)} of your days.
              </>
            ),
            tip: "Try moving your savings out first thing on payday, before the spending starts.",
          }
        : {
            title: "Steady after payday",
            text: (
              <>
                Only {pct(payday.spendShare)} of your spending happens on payday and the 2 days
                after. You don&apos;t splurge when the money comes in.
              </>
            ),
          },
    );
  }

  if (weekend && weekend.weekdayPerDay > 0) {
    const ratio = weekend.weekendPerDay / weekend.weekdayPerDay;
    if (ratio >= 1.25)
      habits.push({
        title: "Weekends cost more",
        text: (
          <>
            You spend <b>{formatPeso(weekend.weekendPerDay)}</b> on an average weekend day, against{" "}
            {formatPeso(weekend.weekdayPerDay)} on a weekday.
          </>
        ),
        tip: "Plan one free weekend activity, and set a cash amount for the weekend.",
      });
    else if (ratio <= 0.8)
      habits.push({
        title: "Weekdays cost more",
        text: (
          <>
            You spend <b>{formatPeso(weekend.weekdayPerDay)}</b> on an average weekday, against{" "}
            {formatPeso(weekend.weekendPerDay)} on a weekend day. Work days add up: fares, lunch,
            coffee.
          </>
        ),
        tip: "Bringing baon a few days a week is one of the easiest cuts.",
      });
  }

  return (
    <Section title="Your habits" note={`Measured over ${windowNote}.`}>
      {habits.length || frequent.length ? (
        <ul className="flex flex-col gap-2">
          {habits.map((h) => (
            <li key={h.title} className="flex flex-col gap-1 rounded-[20px] bg-card px-4 py-3.5">
              <span className="font-bold">{h.title}</span>
              <p className="text-[15px] leading-snug">{h.text}</p>
              {h.tip && <p className="text-[13px] text-muted">Tip: {h.tip}</p>}
            </li>
          ))}
          {frequent.length > 0 && (
            <li className="flex flex-col gap-1 rounded-[20px] bg-card px-4 pt-3.5 pb-1.5">
              <span className="font-bold">Small buys that add up</span>
              <p className="text-[13px] text-muted">In the last 30 days</p>
              <ul className="flex flex-col">
                {frequent.map((f) => (
                  <li key={`${f.key}-${f.sub}`} className="border-b border-line-soft last:border-0">
                    <Link
                      href={activityHref(f.key, f.sub)}
                      className="flex min-h-12 items-center justify-between gap-3 py-2 text-ink"
                    >
                      <span className="min-w-0 text-[15px]">
                        <b>{label(f.key, f.sub)}</b>{" "}
                        <span className="text-muted">
                          {f.count}× · {formatPeso(f.average)} each
                        </span>
                      </span>
                      <span className="shrink-0 font-display text-[17px] font-semibold">
                        {formatPeso(f.total)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      ) : (
        <p className="rounded-[20px] bg-card px-4 py-3 text-[15px] text-muted">
          Keep logging: patterns show up after a few weeks.
        </p>
      )}
    </Section>
  );
}

// ── By category ─────────────────────────────────────────────────────────

/** Each category over the periods shown, growing first; tap one for its subcategories. */
export function CategorySection({
  trends,
  custom,
  unusual,
  isCurrent,
  unit,
  vs,
  activityHref,
}: {
  trends: CategoryTrend[];
  custom: UserCategory[];
  /** Categories well over their usual. */
  unusual: Set<string>;
  isCurrent: boolean;
  unit: string;
  /** The period before, to compare with: "Oct" or "Nov 1 – 15". */
  vs: string;
  activityHref: (key: string, sub?: string | null) => string;
}) {
  return (
    <section aria-labelledby="categories-heading" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 id="categories-heading" className="font-display text-xl font-semibold">
          By category
        </h2>
        <p className="text-[13px] text-muted">Growing first. Tap one for its subcategories.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {trends.map((t) => {
          const info = categoryInfo("expense", t.key, custom);
          return (
            <li key={t.key}>
              <details className="group rounded-[20px] bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span
                    className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] ${info.tint}`}
                  >
                    <PathIcon d={info.icon} size={21} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-bold">{info.label}</span>
                        {unusual.has(t.key) && (
                          <span className="shrink-0 rounded-full bg-sun-tint px-2 py-0.5 text-[11px] font-extrabold text-sun-text">
                            Unusual
                          </span>
                        )}
                      </span>
                      <Amount trend={t} soFar={isCurrent} />
                    </span>
                    <Change trend={t} vs={vs} unit={unit} />
                  </span>
                  <ChevronIcon
                    size={20}
                    className="shrink-0 text-muted transition-transform group-open:rotate-90"
                  />
                </summary>
                <ul className="mx-4 flex flex-col border-t border-line-soft pb-1.5">
                  {t.subs.map((s) => (
                    <li key={s.name ?? ""} className="border-b border-line-soft last:border-0">
                      <Link
                        href={activityHref(t.key, s.name)}
                        className="flex min-h-14 flex-col justify-center gap-0.5 py-2 pl-[54px] text-ink"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-[15px] font-bold ${s.name ? "" : "text-muted"}`}
                          >
                            {s.name ?? "No subcategory"}
                          </span>
                          <Amount trend={s} soFar={false} />
                        </span>
                        <Change trend={s} vs={vs} unit={unit} />
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link
                      href={activityHref(t.key)}
                      className="flex h-11 items-center pl-[54px] text-[15px] font-extrabold text-sea-dark"
                    >
                      See all {info.label} in Activity
                    </Link>
                  </li>
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-muted">
        Transfers and balance adjustments aren&apos;t counted.
      </p>
    </section>
  );
}

function Amount({ trend, soFar }: { trend: Trend; soFar: boolean }) {
  return (
    <span className="shrink-0 font-display text-[17px] font-semibold">
      {formatPeso(trend.current)}
      {soFar && <span className="ml-1 font-sans text-xs font-bold text-muted">so far</span>}
    </span>
  );
}

/** "↑ ₱420 (+18%) vs Nov 1 – 15", in amber when it's more and green when it's less. */
function Change({ trend, vs, unit }: { trend: Trend; vs: string; unit: string }) {
  const { change, percent, current } = trend;
  if (change === 0) {
    return (
      <span className="text-[13px] text-muted">
        {current === 0 ? `None this ${unit}` : `No change vs ${vs}`}
      </span>
    );
  }
  if (percent === null) {
    return <span className="text-[13px] font-bold text-sun-text">New · ₱0 last {unit}</span>;
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

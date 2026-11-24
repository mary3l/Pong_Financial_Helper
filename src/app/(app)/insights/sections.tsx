import Link from "next/link";
import { Pong, type PongMood } from "@/components/pong";
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
import { RemoveGoalButton, SetBudgetButton } from "./goal-controls";

// The sections of Insights, top to bottom: the summary, your goals, what you
// can adjust, budgets, and habits. Server components, given everything
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
  const { spent, usual, diff, ups, down, top } = summary;
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
      {(ups.length > 0 || down || top.keys.length > 1) && (
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
          {top.keys.length > 1 && (
            <li>
              <b className="text-white">Where it goes:</b>{" "}
              {top.keys
                .map((k) => label(k))
                .join(", ")
                .replace(/, ([^,]*)$/, " and $1")}{" "}
              {top.keys.length === 2 ? "are" : "make up"} {pct(top.share)} of your spending.
            </li>
          )}
        </ul>
      )}
      <p className="relative text-[13px] text-sea-text">
        Usual is your average over the {unit === "month" ? "months" : "kinsenas"} before this one
        {isCurrent ? `, scaled to how far into the ${unit} you are` : ""}.
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
      note="Specific, measurable, with an end date: spend under an amount on one category until a day you pick."
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
  return (
    <Section title="What you can adjust" note="Small changes, worked out from your own spending.">
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            <li
              key={`${s.kind}-${s.key}-${"sub" in s ? s.sub : ""}`}
              className="flex flex-col gap-2.5 rounded-[20px] bg-card px-4 py-3.5"
            >
              {s.kind === "fewer" && (
                <>
                  <p className="text-[15px] leading-snug">
                    <b>{label(s.key, s.sub)} 2 fewer times a week</b> saves about{" "}
                    <b className="text-sea-dark">{formatPeso(s.saves)} a month</b>. You have it
                    about {s.perWeek} times a week now.
                  </p>
                  <Link
                    href={goalHref(s)}
                    className="flex h-10 w-fit items-center rounded-full bg-sun px-4 text-sm font-extrabold text-ink"
                  >
                    Make it a goal
                  </Link>
                </>
              )}
              {s.kind === "usual" && (
                <>
                  <p className="text-[15px] leading-snug">
                    <b>{label(s.key, s.sub)}</b> is {formatPeso(s.over)} over your usual. Back to
                    your usual {formatPeso(s.usual)} a {unit} keeps{" "}
                    <b className="text-sea-dark">{formatPeso(s.over)}</b> in your pocket.
                  </p>
                  <Link
                    href={goalHref(s)}
                    className="flex h-10 w-fit items-center rounded-full bg-sun px-4 text-sm font-extrabold text-ink"
                  >
                    Make it a goal
                  </Link>
                </>
              )}
              {s.kind === "budget" && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 text-[15px] leading-snug">
                    <b>{label(s.key)}</b> has no budget, and you usually spend {formatPeso(s.usual)}{" "}
                    a kinsenas on it. A {formatPeso(s.amount)} budget lets Pong warn you before it
                    runs over.
                  </p>
                  <SetBudgetButton category={s.key} amount={s.amount} label={label(s.key)} />
                </div>
              )}
            </li>
          ))}
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

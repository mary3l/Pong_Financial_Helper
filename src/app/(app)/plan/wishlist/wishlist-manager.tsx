"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  makeWishReal,
  removeWish,
  reopenWish,
  saveWish,
  type WishInput,
} from "@/app/wishlist-actions";
import { AmountInput } from "@/components/amount-input";
import { FIELD_CLASS } from "@/components/choice-chip";
import { ForecastChart } from "@/components/forecast-chart";
import { Pong, type PongMood } from "@/components/pong";
import { showToast } from "@/components/toast";
import type { WishItem } from "@/lib/data";
import { addDays, formatShortDay, isValidDate } from "@/lib/dates";
import { MAX_AMOUNT, formatPeso, parseAmount } from "@/lib/money";
import { WINDOW_DAYS, windowOf, type WishPick, type WishResult } from "@/lib/wishlist";

export type WishRow = {
  wish: WishItem;
  result: WishResult | null;
  /** Made real: its unpaid payments in Scheduled; null for none (or before migration 0030). */
  upcoming: {
    count: number;
    first: string;
    last: string;
    /** The next one's amount. */
    next: number;
    /** Saving up: how much is set aside so far. Null for a plan paid another way. */
    saved: number | null;
  } | null;
};

const MOODS: Record<WishPick["verdict"]["tone"], PongMood> = {
  comfortable: "happy",
  tight: "worried",
  wait: "listen",
  no: "shocked",
};

const TONE_LABEL: Record<WishPick["verdict"]["tone"], string> = {
  comfortable: "Comfortable",
  tight: "Tight",
  wait: "Wait",
  no: "Doesn't fit",
};

export function WishlistManager({
  rows,
  today,
  payKnown,
  hasCredit,
  categories,
  savings,
}: {
  rows: WishRow[];
  today: string;
  /** False when paydays add nothing because net pay isn't saved. */
  payKnown: boolean;
  hasCredit: boolean;
  categories: { key: string; label: string }[];
  /** Savings wallets set-asides can go into. */
  savings: { id: string; name: string }[];
}) {
  // null: closed. "new": adding. An id: editing that plan.
  const [editing, setEditing] = useState<string | null>(null);
  const ideas = rows.filter((r) => r.wish.status === "idea");
  const real = rows.filter((r) => r.wish.status === "scheduled");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-[20px] bg-card p-4">
        <Pong mood="ask" size={56} decorative />
        <p className="text-[15px] leading-snug">
          Add what you&apos;re saving for and I&apos;ll pick <strong>when</strong> and{" "}
          <strong>how</strong> so it doesn&apos;t hurt. Each plan is checked on its own: I
          don&apos;t assume you&apos;ll do the others.
        </p>
      </div>

      {editing === "new" ? (
        <WishForm
          today={today}
          hasCredit={hasCredit}
          categories={categories}
          onDone={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="h-12 self-start rounded-[18px] bg-sun px-5 font-extrabold text-ink"
        >
          + Add a plan
        </button>
      )}

      {ideas.length === 0 && editing !== "new" && (
        <p className="text-[15px] text-muted">
          Nothing on your wishlist yet. Try a trip, a new phone, or a gift.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {ideas.map(({ wish, result }) => (
          <li key={wish.id}>
            {editing === wish.id ? (
              <WishForm
                wish={wish}
                today={today}
                hasCredit={hasCredit}
                categories={categories}
                onDone={() => setEditing(null)}
              />
            ) : (
              <WishCard
                wish={wish}
                result={result!}
                today={today}
                categories={categories}
                savings={savings}
                onEdit={() => setEditing(wish.id)}
              />
            )}
          </li>
        ))}
      </ul>

      {!payKnown && ideas.length > 0 && (
        <p className="text-[13px] text-muted">
          Paydays add nothing yet because your net pay isn&apos;t saved, so I err on the careful
          side.
        </p>
      )}

      {real.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-extrabold text-muted">MADE REAL</h2>
          <ul className="flex flex-col divide-y divide-line rounded-[20px] bg-card px-4">
            {real.map(({ wish, upcoming }) => (
              <li key={wish.id} className="flex flex-col gap-1 py-3">
                <span className="min-w-0 truncate font-bold">
                  {wish.name} · {formatPeso(wish.amount)}
                </span>
                {upcoming?.saved != null && (
                  <SavedProgress
                    saved={upcoming.saved}
                    total={wish.amount}
                    next={upcoming.next}
                    on={upcoming.first}
                    today={today}
                  />
                )}
                {upcoming && upcoming.saved == null && (
                  <span className="text-[13px] text-muted">
                    {upcoming.count === 1
                      ? `1 payment · ${formatShortDay(upcoming.first, today)}`
                      : `${upcoming.count} payments · ${formatShortDay(upcoming.first, today)} → ${formatShortDay(upcoming.last, today)}`}
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-x-3">
                  <Link
                    href="/plan/scheduled"
                    className="flex h-11 items-center px-1 text-sm font-extrabold text-sea-dark underline"
                  >
                    In Scheduled
                  </Link>
                  <ChangePlanButton id={wish.id} />
                  <RemoveButton
                    id={wish.id}
                    confirmText={
                      upcoming
                        ? `Tap again: removes it and ${upcoming.count === 1 ? "its payment" : `its ${upcoming.count} payments`}`
                        : undefined
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** When it can be paid: "On Dec 30, 2027", or "Feb 11, 2028 → Jul 11, 2028". */
function windowText(wish: WishItem, today: string): string {
  const { from, last } = windowOf(wish, today);
  if (wish.by) return `Save ${formatShortDay(from, today)} → ready ${formatShortDay(last, today)}`;
  return from === last
    ? `On ${formatShortDay(from, today)}`
    : `${formatShortDay(from, today)} → ${formatShortDay(last, today)}`;
}

function WishCard({
  wish,
  result,
  today,
  categories,
  savings,
  onEdit,
}: {
  wish: WishItem;
  result: WishResult;
  today: string;
  categories: { key: string; label: string }[];
  savings: { id: string; name: string }[];
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [into, setInto] = useState(savings[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const best = result.best;
  const category = categories.find((c) => c.key === wish.category)?.label ?? "Other";

  function makeReal(p: WishPick) {
    setError(null);
    startTransition(async () => {
      const r = await makeWishReal(
        wish.id,
        p.strategy.kind === "save"
          ? { date: p.date, strategy: p.strategy, payments: p.payments, toAccountId: into }
          : { date: p.date, strategy: p.strategy },
      );
      if (r.error) setError(r.error);
      else
        showToast(
          `${wish.name} is in Scheduled · ${p.payments.length > 1 ? `${p.payments.length} ${p.strategy.kind === "save" ? "set-asides" : "payments"}` : formatShortDay(p.date, today)}`,
        );
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate text-lg font-extrabold">{wish.name}</h2>
          <p className="text-[13px] text-muted">
            {formatPeso(wish.amount)} · {category} · {windowText(wish, today)}
          </p>
        </div>
        {best && (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ${
              best.verdict.tone === "comfortable" ? "bg-sea-tint text-sea-dark" : "bg-sun-tint"
            }`}
          >
            {TONE_LABEL[best.verdict.tone]}
          </span>
        )}
      </header>

      {best ? (
        <div className="flex items-start gap-2">
          <Pong mood={MOODS[best.verdict.tone]} size={52} decorative />
          <div className="flex min-w-0 flex-col gap-0.5 text-[15px]">
            <p>
              <strong>Best:</strong> {best.label}
            </p>
            <PickDetails pick={best} today={today} />
            {best.strategy.kind === "save" &&
              (savings.length ? (
                <label className="flex items-center gap-2 text-[13px] font-bold">
                  Into
                  <select
                    value={into}
                    onChange={(e) => setInto(e.target.value)}
                    className={`${FIELD_CLASS} h-9 min-w-0 flex-1 px-2 text-[13px]`}
                  >
                    {savings.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-[13px] text-muted">
                  No savings wallet ·{" "}
                  <Link href="/money" className="font-extrabold text-sea-dark underline">
                    Add one
                  </Link>
                </p>
              ))}
            {/* Right under Best, so it's clearly Best it saves. */}
            <button
              type="button"
              onClick={() => makeReal(best)}
              disabled={pending || (best.strategy.kind === "save" && !into)}
              className="mt-1.5 h-11 self-start rounded-[14px] bg-sun px-4 font-extrabold text-ink disabled:opacity-60"
            >
              {pending ? "Saving…" : "Make it real"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Pong mood="worried" size={52} decorative />
          <p className="text-[15px]">{result.why}</p>
        </div>
      )}

      {open && best && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
          <p className="text-[15px]">{result.why}</p>
          <ForecastChart
            days={best.verdict.before.days}
            compare={best.verdict.after.days}
            low={best.verdict.after.lowest}
            height={90}
            label={`Your wallets before and after ${wish.name}. Lowest point goes from ${formatPeso(best.verdict.before.lowest.balance)} to ${formatPeso(best.verdict.after.lowest.balance)} on ${formatShortDay(best.verdict.after.lowest.date, today)}.`}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0.5 w-4 bg-sea" />
              Without it
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-coral" />
              With it
            </span>
          </div>
          {result.others.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-extrabold text-muted">OTHER WAYS</h3>
              <ul className="flex flex-col divide-y divide-line">
                {result.others.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5 text-[15px]">
                      <p className="font-bold">{p.label}</p>
                      <PickDetails pick={p} today={today} tone />
                    </div>
                    <button
                      type="button"
                      onClick={() => makeReal(p)}
                      disabled={pending}
                      className="h-10 shrink-0 rounded-[14px] border-2 border-line px-3 text-sm font-extrabold hover:bg-mint disabled:opacity-60"
                    >
                      Use this instead
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {best && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="h-11 rounded-[14px] border-2 border-line px-4 font-extrabold hover:bg-mint"
          >
            {open ? "Hide why" : "See why"}
          </button>
        )}
        <button type="button" onClick={onEdit} className="h-11 px-2 font-extrabold text-sea-dark">
          Edit
        </button>
        <RemoveButton id={wish.id} />
      </div>
    </article>
  );
}

/** The daily amount before and after, what to set aside, and any fees. */
function PickDetails({
  pick,
  today,
  tone = false,
}: {
  pick: WishPick;
  today: string;
  tone?: boolean;
}) {
  const cut = pick.verdict.biggestCut;
  const parts = [
    cut
      ? `Daily amount ${formatPeso(cut.before)} → ${formatPeso(cut.after)} from ${cut.from === today ? "today" : formatShortDay(cut.from, today)}`
      : "Daily amount doesn't change",
    pick.fees > 0 ? `${formatPeso(pick.fees)} in fees` : null,
    tone ? TONE_LABEL[pick.verdict.tone] : null,
  ].filter(Boolean);
  return (
    <>
      {pick.setAside && (
        <p className="text-[13px] text-sea-dark">
          Set aside {formatPeso(pick.setAside.perPayday)} each payday until then (
          {pick.setAside.paydays} {pick.setAside.paydays === 1 ? "payday" : "paydays"}).
        </p>
      )}
      <p className="text-[13px] text-muted">{parts.join(" · ")}</p>
    </>
  );
}

/** Saving up: "₱7,500 of ₱30,000 saved · 25%", a bar, and the next set-aside. */
function SavedProgress({
  saved,
  total,
  next,
  on,
  today,
}: {
  saved: number;
  total: number;
  next: number;
  on: string;
  today: string;
}) {
  const share = total > 0 ? Math.min(1, Math.max(0, saved / total)) : 0;
  return (
    <span className="flex flex-col gap-1 text-[13px] text-muted">
      <span>
        {formatPeso(saved)} of {formatPeso(total)} saved · {Math.round(share * 100)}%
      </span>
      <span
        role="progressbar"
        aria-label="Saved"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-line-soft"
      >
        <span className="block h-full bg-sea" style={{ width: `${share * 100}%` }} />
      </span>
      <span>
        Next: {formatPeso(next)} on {formatShortDay(on, today)}
      </span>
    </span>
  );
}

/** Made real: takes its unpaid payments out of Scheduled and makes it an idea again. */
function ChangePlanButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          const r = await reopenWish(id);
          showToast(r.error ?? "Back in your ideas. Edit it or pick another way.");
        })
      }
      disabled={pending}
      className="h-11 px-1 text-sm font-extrabold text-sea-dark disabled:opacity-60"
    >
      {pending ? "Changing…" : "Change plan"}
    </button>
  );
}

function RemoveButton({ id, confirmText }: { id: string; confirmText?: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirm) return setConfirm(true);
        startTransition(async () => {
          const r = await removeWish(id);
          if (r.error) showToast(r.error);
        });
      }}
      onBlur={() => setConfirm(false)}
      disabled={pending}
      className={`h-11 px-2 font-extrabold ${confirm ? "text-coral-text" : "text-muted"}`}
    >
      {confirm ? (confirmText ?? "Tap again to remove") : "Remove"}
    </button>
  );
}

function WishForm({
  wish,
  today,
  hasCredit,
  categories,
  onDone,
}: {
  wish?: WishItem;
  today: string;
  hasCredit: boolean;
  categories: { key: string; label: string }[];
  onDone: () => void;
}) {
  const [name, setName] = useState(wish?.name ?? "");
  const [amountText, setAmountText] = useState(wish ? String(wish.amount) : "");
  const [category, setCategory] = useState(wish?.category ?? "fun");
  const [earliest, setEarliest] = useState(wish?.earliest ?? today);
  // New plans start with a year to pay it off, which you can change.
  const [by, setBy] = useState(wish ? (wish.by ?? "") : addDays(today, WINDOW_DAYS));
  const [feeText, setFeeText] = useState(wish?.feeRate ? String(wish.feeRate) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(amountText);
    if (!name.trim()) return setError("What is it? Give it a name.");
    if (!(amount > 0 && amount <= MAX_AMOUNT)) return setError("Enter an amount above ₱0.");
    if (!isValidDate(earliest)) return setError("Pick the start date.");
    if (by && by < earliest)
      return setError('The "pay off by" date has to be on or after the start date.');
    const input: WishInput = {
      name,
      amount,
      category,
      earliest,
      by: by || null,
      feeRate: feeText.trim() ? Number(feeText) : 0,
    };
    setError(null);
    startTransition(async () => {
      const r = await saveWish(input, wish?.id);
      if (r.error) setError(r.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
      <h2 className="text-lg font-extrabold">{wish ? `Edit ${wish.name}` : "A new plan"}</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="wish-name" className="text-sm font-bold">
          What is it?
        </label>
        <input
          id="wish-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="e.g. Siargao trip"
          className={FIELD_CLASS}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 min-[420px]:gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor="wish-amount" className="text-sm font-bold">
            About how much?
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted"
            >
              ₱
            </span>
            <AmountInput
              id="wish-amount"
              value={amountText}
              onChange={setAmountText}
              placeholder="0.00"
              className={`${FIELD_CLASS} w-full pl-8`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="wish-category" className="text-sm font-bold">
            Category
          </label>
          <select
            id="wish-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={FIELD_CLASS}
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="wish-earliest" className="text-sm font-bold">
            Save from
          </label>
          <input
            id="wish-earliest"
            type="date"
            value={earliest}
            onChange={(e) => setEarliest(e.target.value)}
            className={`${FIELD_CLASS} w-full px-3`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="wish-by" className="text-sm font-bold">
            Ready by
          </label>
          <input
            id="wish-by"
            type="date"
            value={by}
            min={earliest}
            onChange={(e) => setBy(e.target.value)}
            className={`${FIELD_CLASS} w-full px-3`}
          />
        </div>
      </div>
      {hasCredit && (
        <div className="flex items-center gap-2">
          <label htmlFor="wish-fee" className="text-sm font-bold">
            If it goes on a card or BNPL, fee % / mo
          </label>
          <input
            id="wish-fee"
            value={feeText}
            onChange={(e) => setFeeText(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className={`${FIELD_CLASS} h-10 w-20 px-3 text-right`}
          />
        </div>
      )}
      <p className="text-[13px] text-muted">
        Ready by: saved up each payday until then. None: I pick the date.
      </p>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="h-12 flex-[2] rounded-[18px] bg-sun font-extrabold text-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : wish ? "Save changes" : "Add to my wishlist"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="h-12 flex-1 rounded-[18px] border-2 border-line font-extrabold"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

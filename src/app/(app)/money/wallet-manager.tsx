"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { saveTransaction } from "@/app/transaction-actions";
import {
  addWallets,
  removeWallet,
  restoreWallet,
  updateWallet,
  type WalletResult,
} from "@/app/wallet-actions";
import { AmountInput } from "@/components/amount-input";
import { FormDialog } from "@/components/form-dialog";
import { FIELD_CLASS } from "@/components/choice-chip";
import { ChevronIcon } from "@/components/icons";
import type { Account } from "@/lib/data";
import { daysBetween, formatShortDay } from "@/lib/dates";
import { SAVE_EVERY, goalPlan, isGoTyme, type SaveEvery } from "@/lib/goals";
import { PRESET_RATES_AS_OF, interestPresetFor, matchesPreset } from "@/lib/interest-presets";
import {
  CURRENCIES,
  INTEREST_PAYOUTS,
  WALLET_PURPOSES,
  WALLET_TYPES,
  accountTypeLabel,
  canEarnInterest,
  currencySymbol,
  formatBalance,
  formatMoney,
  formatPeso,
  fxGain,
  interestTax,
  isWalletType,
  parseAmount,
  pesoTotal,
  pesoValue,
  suggestedPayout,
  type Currency,
  type InterestEstimate,
  type InterestPayout,
  type WalletPurpose,
  type WalletType,
} from "@/lib/money";

export function WalletManager({
  accounts,
  accrued,
  today,
  usdRate = null,
  purposes = WALLET_PURPOSES.map((p) => p.value),
}: {
  accounts: Account[];
  /** By account id, for wallets with an interest rate. */
  accrued: Record<string, InterestEstimate>;
  today: string;
  /** Today's pesos per US$1, null when no feed answered. */
  usdRate?: number | null;
  /**
   * The categories this list shows (Wallets: spending; Savings: the rest).
   * The first always shows, and a new wallet starts in it.
   */
  purposes?: readonly WalletPurpose[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const editingAccount = active.find((a) => a.id === editing) ?? null;
  const savingsOnly = !purposes.includes("spending");
  // Grouped by category. The first always shows, so "No wallets yet" has a place,
  // and takes any wallet whose category isn't listed (dollars marked Spending).
  const groups = WALLET_PURPOSES.filter((p) => purposes.includes(p.value))
    .map((p) => ({
      ...p,
      wallets: active.filter((a) => a.purpose === p.value || (p.value === purposes[0] && !purposes.includes(a.purpose))),
    }))
    .filter((g) => g.value === purposes[0] || g.wallets.length > 0);

  // Saved into a category this list doesn't show: say where it went.
  function movedNotice(name: string, purpose: WalletPurpose): string | null {
    if (purposes.includes(purpose)) return null;
    return purpose === "spending"
      ? `${name} is spending money now, so it's on the Wallets tab.`
      : `${name} is set aside now, so it's on the Savings tab.`;
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm font-bold text-sea-dark empty:hidden">{notice}</p>

      {editingAccount && (
        <FormDialog title={`Edit ${editingAccount.name}`} onClose={() => setEditing(null)}>
          <WalletForm
            account={editingAccount}
            today={today}
            usdRate={usdRate}
            onCancel={() => setEditing(null)}
            onDone={(result, saved) => {
              setEditing(null);
              setNotice(
                result.archived
                  ? `${editingAccount.name} has history, so it was archived instead of deleted.`
                  : saved
                    ? movedNotice(saved.name, saved.purpose)
                    : null,
              );
            }}
          />
        </FormDialog>
      )}

      {adding && (
        <FormDialog title={savingsOnly ? "Add a savings wallet" : "Add wallet"} onClose={() => setAdding(false)}>
          <WalletForm
            today={today}
            usdRate={usdRate}
            defaultPurpose={purposes[0]}
            onCancel={() => setAdding(false)}
            onDone={(_, saved) => {
              setAdding(false);
              setNotice(saved ? movedNotice(saved.name, saved.purpose) : null);
            }}
          />
        </FormDialog>
      )}

      {groups.map((group) => (
        <section key={group.value} aria-label={group.label} className="flex flex-col gap-1.5">
          {groups.length > 1 && (
            <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
              <span className="font-extrabold">
                {group.label} · {formatPeso(pesoTotal(group.wallets))}
              </span>
              <span className="text-xs text-muted">
                {group.value === "spending" ? "Counts in Safe to spend" : "Set aside, not in Safe to spend"}
              </span>
            </h3>
          )}
          <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
            {group.wallets.map((a) => (
              <li key={a.id} className="border-b border-line-soft py-2.5 last:border-0">
                <div className="flex items-center gap-1">
                  <Link href={`/money/${a.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-ink sm:gap-3">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-bold leading-snug break-words">{a.name}</span>
                      <span className="text-[13px] text-muted">
                        {accountTypeLabel(a.type)}
                        {a.currency === "USD" && " · US dollars"}
                        {a.interestRate !== null && ` · ${a.interestRate}% a year`}
                        {a.interestRate !== null && a.interestPayout === "monthly" && ", paid on the 1st"}
                        {a.interestRate !== null &&
                          a.interestPayout === "maturity" &&
                          a.maturesOn &&
                          (a.maturesOn > today
                            ? `, matures ${formatShortDay(a.maturesOn, today)}`
                            : `, matured ${formatShortDay(a.maturesOn, today)}`)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className={`font-display text-[17px] font-semibold whitespace-nowrap ${a.balance < 0 ? "text-coral-text" : ""}`}>
                        {formatBalance(a)}
                      </span>
                      {a.currency === "USD" && (
                        <span className="text-xs text-muted">
                          ≈ {formatPeso(pesoValue(a))}
                          {fxGain(a) !== 0 && (
                            <span className={`font-bold ${fxGain(a) > 0 ? "text-sea-dark" : "text-coral-text"}`}>
                              {" "}
                              {fxGain(a) > 0 ? "+" : "−"}
                              {formatPeso(Math.abs(fxGain(a)))}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    {/* The whole row opens the wallet; on phones the name needs the room more. */}
                    <ChevronIcon size={20} className="hidden shrink-0 text-muted sm:block" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(a.id);
                      setNotice(null);
                    }}
                    aria-label={`Edit ${a.name}`}
                    className="h-11 shrink-0 rounded-full px-2.5 text-sm font-extrabold text-sea-dark hover:bg-mint sm:px-3"
                  >
                    Edit
                  </button>
                </div>
                {accrued[a.id] && <InterestRow account={a} accrued={accrued[a.id]} today={today} />}
                {a.goalAmount !== null && a.purpose !== "spending" && (
                  <GoalRow account={a} goalAmount={a.goalAmount} accrued={accrued[a.id] ?? null} today={today} />
                )}
              </li>
            ))}
            {!active.length && (
              <li className="py-3 text-[15px] text-muted">
                {savingsOnly
                  ? "Nothing set aside yet. Add where you save, like MariBank, a GoTyme GoalSave or a time deposit."
                  : "No wallets yet. Add the places you keep money."}
              </li>
            )}
          </ul>
        </section>
      ))}

      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setAdding(true);
          setNotice(null);
        }}
        className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
      >
        + Add wallet
      </button>

      {archived.length > 0 && (
        <section aria-labelledby="archived-heading" className="flex flex-col gap-2">
          <h2 id="archived-heading" className="text-[13px] font-extrabold text-muted">ARCHIVED</h2>
          <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
            {archived.map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
                <Link href={`/money/${a.id}`} className="flex min-h-11 flex-1 items-center gap-3 text-muted">
                  <span className="flex-1">{a.name}</span>
                  <span className="text-sm">{formatBalance(a)}</span>
                </Link>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(async () => {
                    const result = await restoreWallet(a.id);
                    setNotice(result.error ?? `${a.name} is back.`);
                  })}
                  className="h-11 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function WalletForm({
  account,
  today,
  usdRate,
  defaultPurpose = "spending",
  onCancel,
  onDone,
}: {
  /** The wallet to edit; omit to add one. */
  account?: Account;
  today: string;
  usdRate: number | null;
  /** A new wallet's category, like Savings when added from the Savings tab. */
  defaultPurpose?: WalletPurpose;
  onCancel: () => void;
  /** `saved` is what was saved; absent when it was removed. */
  onDone: (result: WalletResult, saved?: { name: string; purpose: WalletPurpose }) => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<WalletType>(
    account && isWalletType(account.type) ? account.type : defaultPurpose === "spending" ? "ewallet" : "bank",
  );
  const [balance, setBalance] = useState(account ? String(account.balance) : "");
  const [purpose, setPurpose] = useState<WalletPurpose>(account?.purpose ?? defaultPurpose);
  const [rate, setRate] = useState(account?.interestRate ? String(account.interestRate) : "");
  // A new wallet follows its name (GoTyme pays monthly) until you pick one.
  const [pickedPayout, setPayout] = useState<InterestPayout | null>(account?.interestPayout ?? null);
  const payout = pickedPayout ?? suggestedPayout(name);
  const [goal, setGoal] = useState(account?.goalAmount ? String(account.goalAmount) : "");
  const [goalDate, setGoalDate] = useState(account?.goalDate ?? "");
  // Picked when adding; a wallet keeps its currency, since its history is in it.
  const [currency, setCurrencyState] = useState<Currency>(account?.currency ?? "PHP");
  const usd = currency === "USD";
  // The rate you got for these dollars; Pong values them at today's (usdRate).
  const [fxRate, setFxRate] = useState(account?.boughtAt ? String(account.boughtAt) : "");
  const [maturesOn, setMaturesOn] = useState(account?.maturesOn ?? "");
  const [placedOn, setPlacedOn] = useState(
    account?.interestPayout === "maturity" ? (account.interestSince ?? "") : "",
  );
  // MariBank, GSave, Maya or GoTyme, not set up with its rate yet. A preset in
  // another currency can't apply to a wallet you already have.
  const found = interestPresetFor(name);
  const preset = found && (!account || (found.currency ?? "PHP") === currency) ? found : null;
  const offerPreset = preset && !matchesPreset(preset, { type, purpose, rate, payout, currency });

  function setCurrency(next: Currency) {
    setCurrencyState(next);
    // Dollars are set aside, never spending money, and goals are in pesos.
    if (next === "USD" && purpose === "spending") setPurpose("savings");
  }

  function applyPreset() {
    if (!preset) return;
    setType(preset.type);
    setCurrency(preset.currency ?? "PHP");
    if (preset.savings && purpose === "spending") setPurpose("savings");
    if (preset.rate !== null) setRate(String(preset.rate));
    setPayout(preset.payout);
  }
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = account?.id ?? "new";

  function save(e: React.FormEvent) {
    e.preventDefault();
    const amount = balance.trim() ? parseAmount(balance.replace(/^-/, "")) : 0;
    if (Number.isNaN(amount)) {
      setError("Check the amount.");
      return;
    }
    const value = balance.trim().startsWith("-") ? -amount : amount;
    const typedRate = rate.replace(/[%\s]/g, "");
    const interestRate = canEarnInterest(type) && typedRate ? Number(typedRate) : null;
    if (interestRate !== null && !(/^\d+(\.\d{1,2})?$/.test(typedRate) && interestRate > 0 && interestRate <= 100)) {
      setError("Check the interest rate, like 3.5 for 3.5% a year.");
      return;
    }
    const goalAmount = !usd && purpose !== "spending" && goal.trim() ? parseAmount(goal) : null;
    if (goalAmount !== null && !(goalAmount > 0)) {
      setError("Check the goal amount.");
      return;
    }
    if (goalAmount === null && !usd && purpose !== "spending" && goalDate) {
      setError("Set how much you're saving for, or clear the date.");
      return;
    }
    const typedFx = fxRate.replace(/[₱,\s]/g, "");
    const fx = usd ? Number(typedFx) : null;
    if (usd && !(/^\d+(\.\d{1,4})?$/.test(typedFx) && fx! > 0 && fx! <= 1000)) {
      setError("Set how many pesos US$1 is, like 58.50.");
      return;
    }
    const timeDeposit = interestRate !== null && payout === "maturity";
    if (timeDeposit && !maturesOn) {
      setError("Pick when it matures. The bank's app shows the date.");
      return;
    }
    startTransition(async () => {
      const input = {
        name,
        type,
        balance: value,
        purpose,
        interestRate,
        ...(interestRate !== null && { interestPayout: payout }),
        goalAmount,
        goalDate: goalAmount !== null && goalDate ? goalDate : null,
        ...(usd && { currency, fxRate: fx }),
        maturesOn: timeDeposit ? maturesOn : null,
        placedOn: timeDeposit && placedOn ? placedOn : null,
      };
      const result = account ? await updateWallet(account.id, input) : await addWallets([input]);
      if (result.error) setError(result.error);
      else onDone(result, { name: name.trim() || name, purpose });
    });
  }

  function remove() {
    if (!account) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    startTransition(async () => {
      const result = await removeWallet(account.id);
      if (result.error) setError(result.error);
      else onDone(result);
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`wallet-name-${id}`} className="text-sm font-bold">Name</label>
          <input id={`wallet-name-${id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. GCash" className={FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1 sm:w-44">
          <label htmlFor={`wallet-balance-${id}`} className="text-sm font-bold">In it now</label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">{currencySymbol(currency)}</span>
            <AmountInput id={`wallet-balance-${id}`} value={balance} onChange={setBalance} placeholder="0.00" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
          </div>
        </div>
      </div>
      {offerPreset && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] bg-card px-3 py-2">
          <span className="flex-1 basis-56 text-[13px]">
            <strong>{preset.label}?</strong> {preset.about}{" "}
            {preset.rate !== null && <span className="text-muted">Rate as of {PRESET_RATES_AS_OF}; check the app.</span>}
          </span>
          <button type="button" onClick={applyPreset} className="h-9 rounded-full bg-mint px-3 text-sm font-extrabold text-sea-dark">
            {preset.rate !== null ? `Use ${preset.rate}%` : "Set it up"}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span id={`wallet-currency-${id}`} className="text-sm font-bold">Money in</span>
        {account ? (
          <span className="text-sm">
            {CURRENCIES.find((c) => c.value === currency)?.label}
            <span className="text-xs text-muted"> · A wallet keeps its currency. Add a new one to switch.</span>
          </span>
        ) : (
          <div role="group" aria-labelledby={`wallet-currency-${id}`} className="flex flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={currency === c.value}
                onClick={() => setCurrency(c.value)}
                className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${currency === c.value ? "bg-ink text-mint" : "bg-card text-ink"}`}
              >
                {c.symbol} {c.label}
              </button>
            ))}
          </div>
        )}
        {usd && (
          <div className="mt-1 flex flex-col gap-1">
            <label htmlFor={`wallet-fx-${id}`} className="text-xs font-bold text-muted">You got US$1 for</label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="relative w-44">
                <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
                <input
                  id={`wallet-fx-${id}`}
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 58.50"
                  className={`${FIELD_CLASS} w-full pl-8 text-right`}
                />
              </div>
              {usdRate && (
                <button
                  type="button"
                  onClick={() => setFxRate(String(usdRate))}
                  className="h-9 rounded-full bg-card px-3 text-sm font-extrabold text-sea-dark"
                >
                  Today: {formatPeso(usdRate)}
                </button>
              )}
            </div>
            <span className="text-xs text-muted">
              The rate you converted at, from the bank&apos;s app. Pong values your dollars at today&apos;s rate
              {usdRate ? ` (${formatPeso(usdRate)})` : ""} and shows how many pesos you&apos;ve gained or lost since.
              Moving more pesos in updates this to your average. Dollars are set aside, never in Safe to spend.
            </span>
          </div>
        )}
      </div>
      <div role="group" aria-label="Type" className="flex flex-wrap gap-2">
        {WALLET_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={type === t.value}
            onClick={() => setType(t.value)}
            className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${type === t.value ? "bg-ink text-mint" : "bg-card text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={`wallet-purpose-${id}`} className="text-sm font-bold">Category</span>
        <div role="group" aria-labelledby={`wallet-purpose-${id}`} className="flex flex-wrap gap-2">
          {WALLET_PURPOSES.filter((p) => !usd || p.value !== "spending").map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={purpose === p.value}
              onClick={() => setPurpose(p.value)}
              className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${purpose === p.value ? "bg-ink text-mint" : "bg-card text-ink"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">
          {purpose === "spending"
            ? "Spending money counts in Safe to spend and your forecast."
            : "Shows on the Savings tab and counts in Net worth, but not in You have or Safe to spend, so you won't plan to spend it."}
        </span>
      </div>
      {purpose !== "spending" && !usd && (
        <div className="flex flex-col gap-1.5">
          <span id={`wallet-goal-${id}`} className="text-sm font-bold">
            Goal <span className="font-semibold text-muted">(optional)</span>
          </span>
          <div role="group" aria-labelledby={`wallet-goal-${id}`} className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`wallet-goal-amount-${id}`} className="text-xs font-bold text-muted">Saving for</label>
              <div className="relative w-44">
                <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
                <AmountInput id={`wallet-goal-amount-${id}`} label="Goal" value={goal} onChange={setGoal} placeholder="e.g. 50,000" className={`${FIELD_CLASS} w-full pl-8 text-right`} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`wallet-goal-date-${id}`} className="text-xs font-bold text-muted">By (optional)</label>
              <input
                id={`wallet-goal-date-${id}`}
                type="date"
                value={goalDate}
                min={account?.goalDate && account.goalDate < today ? undefined : today}
                onChange={(e) => setGoalDate(e.target.value)}
                className={FIELD_CLASS}
              />
            </div>
          </div>
          <span className="text-xs text-muted">
            Like a GoTyme GoalSave. With a date, Pong works out what to put in every day, week or month to get
            there, counting this wallet&apos;s interest.
          </span>
        </div>
      )}
      {canEarnInterest(type) && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`wallet-rate-${id}`} className="text-sm font-bold">
            Interest rate <span className="font-semibold text-muted">(optional)</span>
          </label>
          <div className="relative w-44">
            <input
              id={`wallet-rate-${id}`}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 3.5"
              aria-describedby={`wallet-rate-hint-${id}`}
              className={`${FIELD_CLASS} w-full pr-24 text-right`}
            />
            <span aria-hidden="true" className="absolute top-1/2 right-4 -translate-y-1/2 font-bold text-muted">% a year</span>
          </div>
          <span id={`wallet-rate-hint-${id}`} className="text-xs text-muted">
            For savings that pay interest, like MariBank, GSave, Maya Savings and GoTyme. Check the
            rate in their app; Pong estimates what you earn after the {Math.round(interestTax(currency) * 100)}% tax
            {usd && " on dollar deposits"}.
          </span>
          {rate.trim() && (
            <div className="mt-2 flex flex-col gap-1.5">
              <span id={`wallet-payout-${id}`} className="text-sm font-bold">Interest is added</span>
              <div role="group" aria-labelledby={`wallet-payout-${id}`} className="flex flex-wrap gap-2">
                {INTEREST_PAYOUTS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={payout === p.value}
                    onClick={() => setPayout(p.value)}
                    className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${payout === p.value ? "bg-ink text-mint" : "bg-card text-ink"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted">
                {payout === "monthly"
                  ? "Like GoTyme GoalSave and GSave: worked out daily, added to your balance once a month."
                  : payout === "maturity"
                    ? "Like a time deposit: worked out daily, added all at once on the day it matures."
                    : "Like MariBank and Maya Savings: added to your balance every day."}
              </span>
              {payout === "maturity" && (
                <div className="flex flex-wrap gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`wallet-placed-${id}`} className="text-xs font-bold text-muted">Put in on (optional)</label>
                    <input
                      id={`wallet-placed-${id}`}
                      type="date"
                      value={placedOn}
                      max={today}
                      onChange={(e) => setPlacedOn(e.target.value)}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`wallet-matures-${id}`} className="text-xs font-bold text-muted">Matures on</label>
                    <input
                      id={`wallet-matures-${id}`}
                      type="date"
                      value={maturesOn}
                      min={placedOn || undefined}
                      onChange={(e) => setMaturesOn(e.target.value)}
                      required
                      className={FIELD_CLASS}
                    />
                  </div>
                  <span className="basis-full text-xs text-muted">
                    Interest counts from the day you put the money in (today if you leave it empty). Taking it
                    out before it matures usually loses the interest.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {account && (
        <p className="text-xs text-muted">Changing the amount adjusts the starting balance. Your logged transactions stay as they are.</p>
      )}
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : account ? "Update wallet" : "Add wallet"}
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
          Cancel
        </button>
        {account && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className={`ml-auto h-11 rounded-[14px] px-4 font-extrabold ${confirmRemove ? "bg-coral text-white" : "text-coral-text hover:bg-coral-tint"}`}
          >
            {confirmRemove ? "Tap again to remove" : "Remove"}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Interest on a MariBank or GoTyme wallet: what it earns a day and what's
 * built up. MariBank adds it daily, so all of that is in the bank's balance;
 * GoTyme adds the month's interest on the 1st. Add interest logs what was
 * credited as income, so the balance here keeps up with the bank's.
 */
function InterestRow({ account, accrued, today }: { account: Account; accrued: InterestEstimate; today: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Monthly and time deposits: credited later. Daily: already in the balance.
  const monthly = account.interestPayout !== "daily";
  const matured = account.interestPayout === "maturity" && accrued.nextPayout === null;
  // Daily: everything so far, dated today. Otherwise only what was credited (on the 1st, or when it matured).
  const toLog = monthly ? accrued.credited : { on: today, amount: accrued.amount };
  const money = (value: number) => formatMoney(value, account.currency);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const value = parseAmount(amount);
    if (Number.isNaN(value) || value <= 0) {
      setError("Enter the interest you got. The bank's app shows it.");
      return;
    }
    startTransition(async () => {
      const result = await saveTransaction({
        type: "income",
        amount: value,
        accountId: account.id,
        toAccountId: null,
        category: "interest",
        note: "Interest",
        occurredOn: toLog?.on ?? today,
      });
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-[14px] bg-mint px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex flex-1 flex-col text-[13px]">
          {matured ? (
            <span>
              Matured {formatShortDay(account.maturesOn!, today)}.
              {!accrued.credited && " If it rolled over, edit it and set the new maturity date."}
            </span>
          ) : (
            <span>
              Earns ≈ <strong>{money(accrued.perDay)}</strong> a day after tax
              {monthly
                ? ` · ≈ ${money(accrued.amount)} so far, added ${formatShortDay(accrued.nextPayout!, today)}`
                : accrued.days > 0
                  ? ` · ≈ ${money(accrued.amount)} since ${formatShortDay(accrued.since, today)}`
                  : " · counting from today"}
            </span>
          )}
          {accrued.credited && (
            <span className="font-bold">
              ≈ {money(accrued.credited.amount)} was added on {formatShortDay(accrued.credited.on, today)}
              {/* More than a month not logged: say where it starts. */}
              {daysBetween(accrued.credited.from, accrued.credited.on) > 31 &&
                ` (since ${formatShortDay(accrued.credited.from, today)})`}
              . Log it so your balance matches.
            </span>
          )}
        </span>
        {toLog && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setOpen(true);
              setAmount(toLog.amount > 0 ? String(toLog.amount) : "");
              setError(null);
            }}
            className="h-9 rounded-full bg-card px-3 text-sm font-extrabold text-sea-dark"
          >
            + Add interest
          </button>
        )}
      </div>
      {open && (
        <FormDialog title={`Interest on ${account.name}`} onClose={() => setOpen(false)}>
          <form onSubmit={save} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`interest-${account.id}`} className="text-sm font-bold">
                Interest credited to {account.name}
                {monthly && toLog && ` on ${formatShortDay(toLog.on, today)}`}
              </label>
              <div className="relative sm:w-44">
                <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">
                  {currencySymbol(account.currency)}
                </span>
                <input
                  id={`interest-${account.id}`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${FIELD_CLASS} w-full pl-8 text-right`}
                />
              </div>
            </div>
            <p className="text-xs text-muted">
              {account.interestPayout === "maturity" ? (
                <>
                  Filled in with Pong&apos;s estimate. The bank adds the interest when it matures, after
                  tax, so type the exact amount from its app if you have it.
                </>
              ) : monthly ? (
                <>
                  Filled in with Pong&apos;s estimate on today&apos;s balance. The bank adds the month&apos;s
                  interest on the 1st, after tax, so type the exact amount from its app if you have it.
                </>
              ) : (
                <>
                  Filled in with Pong&apos;s estimate. The bank adds interest daily on that day&apos;s
                  balance, so type the exact amount from its app if you have it.
                </>
              )}
            </p>
            <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
                {pending ? "Saving…" : "Add as income"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
                Cancel
              </button>
            </div>
          </form>
        </FormDialog>
      )}
    </div>
  );
}

/**
 * A wallet's goal, worked out like GoTyme GoalSave: how far along it is and,
 * with a deadline, what to put in each day, week or month (GoTyme's
 * auto-save choices) to get there, with the interest the bank adds.
 */
function GoalRow({
  account,
  goalAmount,
  accrued,
  today,
}: {
  account: Account;
  goalAmount: number;
  accrued: InterestEstimate | null;
  today: string;
}) {
  const [every, setEvery] = useState<SaveEvery>("monthly");
  const plan = useMemo(
    () => goalPlan(account, { amount: goalAmount, date: account.goalDate }, today, accrued),
    [account, goalAmount, accrued, today],
  );
  const by = plan.deadline ? formatShortDay(plan.deadline, today) : null;
  const pace = plan.needed?.[every];
  const per = SAVE_EVERY.find((s) => s.value === every)!.per;
  const percent = Math.floor(plan.progress * 100);

  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-[14px] bg-mint px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span>
          <strong>{formatPeso(plan.saved)}</strong> of {formatPeso(plan.target)} · {percent}%
        </span>
        {by && plan.daysLeft !== null && (
          <span className="text-muted">
            by {by}
            {plan.daysLeft >= 0 && ` · ${plan.daysLeft === 0 ? "today" : `${plan.daysLeft} days left`}`}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={`${account.name} goal`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full rounded-full bg-sea" style={{ width: `${plan.progress * 100}%` }} />
      </div>

      {plan.reached ? (
        <span className="font-bold">Goal reached. Edit it to set a bigger one.</span>
      ) : plan.daysLeft === null ? (
        <span>{formatPeso(plan.left)} to go. Add a date to see what to save each month.</span>
      ) : plan.daysLeft < 0 ? (
        <span className="font-bold">The date passed with {formatPeso(plan.left)} to go. Edit the goal to pick a new one.</span>
      ) : !plan.needed || !pace ? (
        <span className="font-bold">
          Interest alone gets you there: ≈ {formatPeso(plan.interestOnly?.balance ?? plan.saved)} by {by}.
        </span>
      ) : (
        <>
          <div role="group" aria-label="How often you save" className="flex flex-wrap gap-1.5">
            {SAVE_EVERY.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={every === s.value}
                onClick={() => setEvery(s.value)}
                className={`h-8 rounded-full px-3 text-xs font-extrabold ${every === s.value ? "bg-ink text-mint" : "bg-card text-ink"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span>
            Put in <strong>{formatPeso(pace.amount)} {per}</strong>, starting today
            {pace.deposits > 1 && ` (${pace.deposits} times)`}
            {pace.interest > 0 ? `. Interest adds ≈ ${formatPeso(pace.interest)} by then, after tax.` : "."}
            {isGoTyme(account.name) && " Set it as auto-save in GoTyme."}
          </span>
        </>
      )}
    </div>
  );
}

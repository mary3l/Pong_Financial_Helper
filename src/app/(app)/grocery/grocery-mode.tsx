"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { saveGroceryTrip } from "@/app/grocery-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { Pong } from "@/components/pong";
import { showToast } from "@/components/toast";
import { clearTrip, loadTrip, saveTrip, type ActiveTrip } from "@/lib/active-trip";
import type { Account } from "@/lib/data";
import { formatShortDay } from "@/lib/dates";
import {
  addToCart,
  budgetStatus,
  cartCount,
  cartTotal,
  receiptNote,
  rememberedPrice,
  scanNote,
  type CartItem,
  type PriceMemory,
} from "@/lib/grocery";
import { formatPeso, parseAmount, roundCents } from "@/lib/money";
import { BarcodeScanner } from "./barcode-scanner";

const WARN_LEVELS = [0.7, 0.8, 0.9];

type Step = "start" | "scan" | "checkout" | "done";

export function GroceryMode({
  wallets,
  groceriesLeft,
  groceriesBudget,
  memory,
  stores,
  today,
}: {
  wallets: Account[];
  /** What's left in the Groceries budget this kinsenas; null without one. */
  groceriesLeft: number | null;
  groceriesBudget: number | null;
  memory: PriceMemory;
  stores: string[];
  today: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<Step>("start");
  const [trip, setTrip] = useState<ActiveTrip>({
    budget: groceriesLeft || null,
    store: stores[0] ?? "",
    accountId: wallets[0]?.id ?? "",
    warnAt: 0.8,
    items: [],
    step: "scan",
    startedOn: today,
  });

  // Pick up a trip in progress on this phone.
  useEffect(() => {
    loadTrip().then((saved) => {
      if (saved) {
        setTrip(saved);
        setStep(saved.step);
      }
      setLoaded(true);
    });
  }, []);

  function update(next: ActiveTrip, nextStep: Step = step) {
    setTrip(next);
    setStep(nextStep);
    if (nextStep === "scan" || nextStep === "checkout") saveTrip({ ...next, step: nextStep });
  }

  if (!loaded) return <div aria-busy="true" className="h-[640px] rounded-[20px] bg-line-soft" />;
  if (!wallets.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center">
        <Pong mood="ask" size={100} decorative />
        <p className="text-[15px] text-muted">
          Add a wallet first, so I know what you&apos;ll pay with.
        </p>
        <Link href="/money" className="font-extrabold text-sea-dark underline">
          Add a wallet
        </Link>
      </div>
    );
  }

  if (step === "start") {
    return (
      <StartTrip
        trip={trip}
        wallets={wallets}
        stores={stores}
        groceriesLeft={groceriesLeft}
        onStart={(t) => update(t, "scan")}
      />
    );
  }
  if (step === "scan") {
    return (
      <Scanning
        trip={trip}
        memory={memory}
        onChange={(t) => update(t)}
        onBack={() => update(trip, "start")}
        onCheckout={() => update(trip, "checkout")}
      />
    );
  }
  if (step === "checkout") {
    return (
      <Checkout
        trip={trip}
        wallets={wallets}
        groceriesLeft={groceriesLeft}
        groceriesBudget={groceriesBudget}
        today={today}
        onChange={(t) => update(t)}
        onBack={() => update(trip, "scan")}
        onSaved={() => {
          clearTrip();
          setStep("done");
        }}
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-card px-6 py-10 text-center">
      <Pong mood="proud" size={120} decorative />
      <h1 className="font-display text-2xl font-semibold">Groceries saved!</h1>
      <p className="max-w-xs text-[15px] text-muted">
        One Groceries expense with your items attached. I remembered the prices for next time.
      </p>
      <div className="flex gap-2">
        <Link
          href="/"
          className="flex h-12 items-center rounded-[18px] bg-sun px-5 font-extrabold text-ink"
        >
          Home
        </Link>
        <button
          type="button"
          onClick={() => {
            setTrip({ ...trip, items: [] });
            setStep("start");
          }}
          className="h-12 rounded-[18px] px-4 font-extrabold text-sea-dark"
        >
          New trip
        </button>
      </div>
    </div>
  );
}

function StartTrip({
  trip,
  wallets,
  stores,
  groceriesLeft,
  onStart,
}: {
  trip: ActiveTrip;
  wallets: Account[];
  stores: string[];
  groceriesLeft: number | null;
  onStart: (trip: ActiveTrip) => void;
}) {
  const [budget, setBudget] = useState(trip.budget ? String(trip.budget) : "");
  const [store, setStore] = useState(trip.store);
  const [other, setOther] = useState(!stores.includes(trip.store));
  const [accountId, setAccountId] = useState(trip.accountId);
  const [warnAt, setWarnAt] = useState(trip.warnAt);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = budget.trim() ? parseAmount(budget) : null;
        if (value !== null && !(value > 0)) {
          setError("Check the budget, or leave it blank.");
          return;
        }
        if (!store.trim()) {
          setError("Which store? Prices are remembered per store.");
          return;
        }
        onStart({ ...trip, budget: value, store: store.trim(), accountId, warnAt });
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex h-10 items-center justify-between">
        <Link href="/" className="font-extrabold text-sea-dark">
          Cancel
        </Link>
        <span className="font-extrabold">Grocery trip</span>
        <span className="w-12" aria-hidden="true" />
      </div>
      <div className="flex items-end gap-2">
        <Pong mood="happy" size={80} decorative />
        <div className="flex flex-col gap-1 pb-2">
          <h1 className="font-display text-2xl font-semibold">Set your cart budget</h1>
          <p className="text-[15px] leading-snug text-muted">
            Scan items as they go in the cart. You&apos;ll always see what&apos;s left before the
            counter.
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 rounded-[20px] bg-card p-4">
        <label htmlFor="trip-budget" className="text-[13px] font-extrabold text-muted">
          BUDGET FOR THIS TRIP
        </label>
        <AmountInput
          id="trip-budget"
          value={budget}
          onChange={setBudget}
          placeholder="₱ 0"
          className="w-full bg-transparent pl-11 text-center font-display text-4xl font-semibold outline-none"
        />
        <span className="text-xs text-muted">
          {groceriesLeft !== null ? (
            `Prefilled: what's left in Groceries this kinsenas (${formatPeso(groceriesLeft)})`
          ) : (
            <>
              No Groceries budget yet.{" "}
              <Link href="/plan/budgets" className="font-bold text-sea-dark underline">
                Set one
              </Link>
            </>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span id="store-label" className="text-sm font-extrabold">
          Store
        </span>
        <div role="group" aria-labelledby="store-label" className="flex flex-wrap gap-2">
          {stores.slice(0, 6).map((s) => (
            <ChoiceChip
              key={s}
              selected={!other && store === s}
              onClick={() => {
                setStore(s);
                setOther(false);
              }}
              className={!other && store === s ? "" : "bg-card"}
            >
              {s}
            </ChoiceChip>
          ))}
          <ChoiceChip
            selected={other}
            onClick={() => {
              setOther(true);
              setStore("");
            }}
            className={other ? "" : "bg-card"}
          >
            + Other
          </ChoiceChip>
        </div>
        {other && (
          <>
            <label htmlFor="store-name" className="sr-only">
              Store name
            </label>
            <input
              id="store-name"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              maxLength={60}
              placeholder="e.g. SM Hypermarket"
              className={FIELD_CLASS}
            />
          </>
        )}
        <span className="text-xs text-muted">Prices are remembered per store.</span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-[20px] bg-card p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="trip-wallet" className="text-sm font-bold">
            Pay with
          </label>
          <select
            id="trip-wallet"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={FIELD_CLASS}
          >
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="trip-warn" className="text-sm font-bold">
            Warn me at
          </label>
          <select
            id="trip-warn"
            value={warnAt}
            onChange={(e) => setWarnAt(Number(e.target.value))}
            className={FIELD_CLASS}
          >
            {WARN_LEVELS.map((w) => (
              <option key={w} value={w}>
                {Math.round(w * 100)}%
              </option>
            ))}
          </select>
        </div>
      </div>

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <button type="submit" className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink">
        {trip.items.length ? "Back to scanning" : "Start scanning"}
      </button>
    </form>
  );
}

function Scanning({
  trip,
  memory,
  onChange,
  onBack,
  onCheckout,
}: {
  trip: ActiveTrip;
  memory: PriceMemory;
  onChange: (trip: ActiveTrip) => void;
  onBack: () => void;
  onCheckout: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [unknownName, setUnknownName] = useState("");
  const [unknownPrice, setUnknownPrice] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [last, setLast] = useState<{ name: string; note: string } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = cartTotal(trip.items);
  const count = cartCount(trip.items);
  const status = budgetStatus(total, trip.budget, trip.warnAt);
  // Items scanned earlier this trip count as memory too.
  const tripMemory = (code: string) => trip.items.find((i) => i.barcode === code);

  function add(item: Omit<CartItem, "key" | "qty">) {
    const key = crypto.randomUUID();
    const items = addToCart(trip.items, item, key);
    const added = items.find(
      (i) => i.name === item.name && i.price === item.price && i.barcode === item.barcode,
    )!;
    setHistory((h) => [...h, added.key]);
    setLast({
      name: `${item.name} ${formatPeso(item.price)}`,
      note: scanNote(total, item.price, trip.budget),
    });
    onChange({ ...trip, items });
  }

  function onScan(code: string) {
    setScanning(false);
    setError(null);
    const seen = tripMemory(code);
    if (seen) return add({ barcode: code, name: seen.name, price: seen.price });
    const known = rememberedPrice(memory, code, trip.store);
    if (known) return add({ barcode: code, name: known.name, price: known.price });
    // First time: type name and price once; next time it fills in by itself.
    setUnknown(code);
    setUnknownName("");
    setUnknownPrice("");
  }

  function setQty(key: string, delta: number) {
    onChange({
      ...trip,
      items: trip.items
        .map((i) => (i.key === key ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0),
    });
  }

  function undo() {
    const key = history.at(-1);
    if (!key) return;
    const item = trip.items.find((i) => i.key === key);
    setHistory((h) => h.slice(0, -1));
    if (item) {
      setQty(key, -1);
      setLast({ name: item.name, note: "removed" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-10 items-center justify-between">
        <button type="button" onClick={onBack} className="font-extrabold text-sea-dark">
          ‹ Trip
        </button>
        <span className="font-extrabold">
          {trip.store} · {count} {count === 1 ? "item" : "items"}
        </span>
        <button
          type="button"
          onBlur={() => setConfirmClear(false)}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            setHistory([]);
            setLast(null);
            onChange({ ...trip, items: [] });
          }}
          className={`h-10 rounded-full px-3 font-extrabold ${confirmClear ? "bg-coral text-white" : "text-sea-dark"}`}
        >
          {confirmClear ? "Clear all?" : "Clear"}
        </button>
      </div>

      <section
        aria-live="polite"
        className={`flex items-center gap-2 rounded-[22px] p-4 ${status.tone === "over" ? "bg-coral text-white" : status.tone === "careful" ? "bg-sun-tint" : "bg-card"}`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-4xl font-semibold">{formatPeso(total)}</span>
            {trip.budget && (
              <span className="text-[15px] font-bold opacity-80">of {formatPeso(trip.budget)}</span>
            )}
          </div>
          {trip.budget && (
            <div
              role="progressbar"
              aria-label="Trip budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status.pct}
              className={`h-3 overflow-hidden rounded-full ${status.tone === "over" ? "bg-white/40" : "bg-line"}`}
            >
              <div
                className={`h-full rounded-full ${status.tone === "over" ? "bg-card" : status.tone === "careful" ? "bg-sun" : "bg-sea"}`}
                style={{ width: `${status.pct}%` }}
              />
            </div>
          )}
          <span className="font-extrabold">{status.message}</span>
        </div>
        <Pong mood={status.mood} size={72} decorative />
      </section>

      {scanning ? (
        <BarcodeScanner onDetected={onScan} onClose={() => setScanning(false)} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="h-[52px] rounded-[18px] bg-sea font-extrabold text-white"
          >
            Scan barcode
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={!history.length}
            className="h-[52px] rounded-[18px] bg-card px-5 font-extrabold text-ink disabled:opacity-50"
          >
            Undo
          </button>
          <Link
            href="/compare"
            className="flex h-[52px] items-center rounded-[18px] bg-card px-5 font-extrabold text-ink"
          >
            Compare
          </Link>
        </div>
      )}

      {last && (
        <p role="status" className="rounded-2xl bg-card px-4 py-2.5 text-[15px]">
          <strong>{last.name}</strong>{" "}
          {last.note === "removed" ? "removed" : `added · ${last.note}`}
        </p>
      )}

      {unknown && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = parseAmount(unknownPrice);
            if (!(value > 0)) {
              setError("Type the price on the shelf tag.");
              return;
            }
            add({ barcode: unknown, name: unknownName.trim() || "Item", price: value });
            setUnknown(null);
          }}
          className="flex flex-col gap-2 rounded-[20px] bg-card p-4"
        >
          <span className="text-sm font-extrabold">New item · I&apos;ll remember it next time</span>
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
            <label htmlFor="new-name" className="sr-only">
              Item name
            </label>
            <input
              id="new-name"
              autoFocus
              value={unknownName}
              onChange={(e) => setUnknownName(e.target.value)}
              maxLength={80}
              placeholder="Name, e.g. Rice 5 kg"
              className={FIELD_CLASS}
            />
            <label htmlFor="new-price" className="sr-only">
              Price
            </label>
            <AmountInput
              id="new-price"
              value={unknownPrice}
              onChange={setUnknownPrice}
              placeholder="₱ 0"
              className={`${FIELD_CLASS} pl-3 text-right`}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setUnknown(null)}
              className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-mint"
            >
              Skip
            </button>
          </div>
        </form>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = parseAmount(price);
          if (!(value > 0)) {
            setError("Type a price.");
            return;
          }
          setError(null);
          add({ barcode: null, name: name.trim() || "Item", price: value });
          setName("");
          setPrice("");
        }}
        className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-name" className="text-xs font-extrabold">
            No barcode? Item
          </label>
          <input
            id="manual-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Pechay"
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-price" className="text-xs font-extrabold">
            Price
          </label>
          <AmountInput
            id="manual-price"
            value={price}
            onChange={setPrice}
            placeholder="₱ 0"
            className={`${FIELD_CLASS} pl-3 text-right`}
          />
        </div>
        <button type="submit" className="h-12 rounded-[14px] bg-card px-4 font-extrabold text-ink">
          Add
        </button>
      </form>
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>

      <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1">
        {trip.items.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-2 border-b border-line-soft py-2.5 last:border-0"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-bold">{item.name}</span>
              <span className="text-xs text-muted">{formatPeso(item.price)} each</span>
            </span>
            <button
              type="button"
              onClick={() => setQty(item.key, -1)}
              aria-label={`One less ${item.name}`}
              className="h-9 w-9 rounded-full bg-mint text-lg font-extrabold"
            >
              −
            </button>
            <span className="w-6 text-center font-extrabold">{item.qty}</span>
            <button
              type="button"
              onClick={() => setQty(item.key, 1)}
              aria-label={`One more ${item.name}`}
              className="h-9 w-9 rounded-full bg-mint text-lg font-extrabold"
            >
              +
            </button>
            <span className="w-20 text-right font-display font-semibold">
              {formatPeso(roundCents(item.price * item.qty))}
            </span>
          </li>
        ))}
        {!trip.items.length && (
          <li className="py-8 text-center text-[15px] text-muted">
            Cart is empty. Tap Scan barcode to add your first item.
          </li>
        )}
      </ul>

      <p className="text-xs text-muted">
        Scanned items are a draft, not spending yet. Your cart is saved on this phone, even with
        weak signal.
      </p>
      <button
        type="button"
        onClick={onCheckout}
        disabled={!trip.items.length}
        className="sticky bottom-24 h-14 rounded-[20px] bg-ink text-lg font-extrabold text-mint disabled:opacity-60 lg:bottom-4"
      >
        Done shopping · {formatPeso(total)}
      </button>
    </div>
  );
}

function Checkout({
  trip,
  wallets,
  groceriesLeft,
  groceriesBudget,
  today,
  onChange,
  onBack,
  onSaved,
}: {
  trip: ActiveTrip;
  wallets: Account[];
  groceriesLeft: number | null;
  groceriesBudget: number | null;
  today: string;
  onChange: (trip: ActiveTrip) => void;
  onBack: () => void;
  onSaved: () => void;
}) {
  const scanned = cartTotal(trip.items);
  const [receipt, setReceipt] = useState(String(scanned));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const value = parseAmount(receipt);
  const valid = value > 0;
  const diff = valid ? roundCents(value - scanned) : 0;
  const wallet = wallets.find((w) => w.id === trip.accountId);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex h-10 w-fit items-center font-extrabold text-sea-dark"
      >
        ‹ Back to cart
      </button>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Checkout</h1>
        <p className="text-[15px] text-muted">
          Type the total on your receipt. That&apos;s the amount that gets saved.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-[20px] bg-card p-4">
        <div className="flex justify-between text-[15px]">
          <span>Scanned total ({cartCount(trip.items)} items)</span>
          <span className="font-extrabold">{formatPeso(scanned)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="receipt" className="font-extrabold">
            Receipt total
          </label>
          <div className="relative w-40">
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted"
            >
              ₱
            </span>
            <AmountInput
              id="receipt"
              value={receipt}
              onChange={setReceipt}
              className={`${FIELD_CLASS} w-full pl-8 text-right font-extrabold`}
            />
          </div>
        </div>
        <div className="flex justify-between text-[15px]">
          <span>Difference</span>
          <span className={`font-extrabold ${diff > 0 ? "text-coral-text" : ""}`}>
            {diff > 0 ? "+" : diff < 0 ? "−" : ""}
            {formatPeso(Math.abs(diff))}
          </span>
        </div>
      </div>
      {valid && (
        <p className="rounded-2xl bg-sun-tint px-4 py-3 text-sm leading-relaxed">
          {receiptNote(scanned, value)} Scanned prices go to price memory either way.
        </p>
      )}

      <section
        aria-labelledby="saved-heading"
        className="flex flex-col gap-2 rounded-[20px] bg-card p-4 text-[15px]"
      >
        <h2 id="saved-heading" className="text-[13px] font-extrabold text-muted">
          WHAT GETS SAVED
        </h2>
        <div className="flex justify-between">
          <span>1 expense · Groceries</span>
          <span className="font-extrabold">{valid ? formatPeso(value) : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="checkout-wallet">Paid from</label>
          <select
            id="checkout-wallet"
            value={trip.accountId}
            onChange={(e) => onChange({ ...trip, accountId: e.target.value })}
            className="h-10 rounded-[12px] bg-mint px-2 font-extrabold outline-none focus:ring-2 focus:ring-sea"
          >
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-between">
          <span>Items attached</span>
          <span className="font-extrabold">{trip.items.length}</span>
        </div>
        {groceriesLeft !== null && groceriesBudget !== null && valid && (
          <div className="flex justify-between">
            <span>Groceries budget left</span>
            <span
              className={`font-extrabold ${groceriesLeft - value < 0 ? "text-coral-text" : ""}`}
            >
              {formatPeso(roundCents(groceriesLeft - value))} of {formatPeso(groceriesBudget)}
            </span>
          </div>
        )}
        {trip.budget && valid && (
          <p className="text-sm text-muted">
            {value <= trip.budget
              ? `${formatPeso(roundCents(trip.budget - value))} under this trip's budget. Nice!`
              : `${formatPeso(roundCents(value - trip.budget))} over this trip's budget.`}
          </p>
        )}
      </section>

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <button
        type="button"
        disabled={pending || !valid}
        onClick={() =>
          startTransition(async () => {
            const result = await saveGroceryTrip({
              store: trip.store,
              budget: trip.budget,
              accountId: trip.accountId,
              receiptTotal: value,
              occurredOn: today,
              items: trip.items.map(({ barcode, name, price, qty }) => ({
                barcode,
                name,
                price,
                qty,
              })),
            });
            if (result.error) setError(result.error);
            else {
              showToast(
                [
                  "Saved",
                  formatPeso(value),
                  result.billDue ? `${formatShortDay(result.billDue, today)} bill` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              );
              onSaved();
            }
          })
        }
        className="h-14 rounded-[20px] bg-sun text-lg font-extrabold text-ink disabled:opacity-60"
      >
        {pending
          ? "Saving…"
          : `Enter ${valid ? `${formatPeso(value)} ` : ""}groceries${wallet ? ` from ${wallet.name}` : ""}`}
      </button>
    </div>
  );
}

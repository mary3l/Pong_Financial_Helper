"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { saveSplit } from "@/app/people-actions";
import {
  deleteTransaction,
  saveBnplPurchase,
  saveTransaction,
} from "@/app/transaction-actions";
import { AmountInput } from "@/components/amount-input";
import { CloseIcon, PathIcon } from "@/components/icons";
import { Keypad } from "@/components/keypad";
import { Pong, type PongMood } from "@/components/pong";
import {
  amountToExpression,
  evaluate,
  expressionFromText,
  hasOperator,
  keyFromKeyboard,
  press,
  prettyExpression,
  type Key,
} from "@/lib/calculator";
import { SUBCATEGORY_MAX, categoriesFor, categoryInfo, categoryLabel, cleanSubcategory } from "@/lib/categories";
import type { Account, Template, Transaction } from "@/lib/data";
import { clockOf, formatRelativeDay, formatShortDay, isValidDate } from "@/lib/dates";
import { bnplFee, bnplFirstDue, buildSchedule } from "@/lib/installments";
import {
  balanceEffect,
  currencySymbol,
  formatMoney,
  formatPeso,
  isSpendable,
  parseAmount,
  paysInPesos,
  roundCents,
  type Currency,
  type TransactionType,
} from "@/lib/money";
import { equalShares } from "@/lib/people";

// Design canvas 2.2 (phone) and "Web · Add expense modal" (desktop).
// One form for adding and editing expenses, income and transfers.

const TYPES: { value: TransactionType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
];

/** Someone in a split: a saved person, or a new name. */
type Participant = { key: string; personId: string | null; name: string };

/** A hint in the subcategory box, per category. */
const SUBCATEGORY_EXAMPLES: Record<string, string> = {
  food: "Merienda",
  groceries: "Puregold",
  transport: "Jeep",
  bills: "Electricity",
  load: "Globe",
  shopping: "Clothes",
  health: "Medicine",
  family: "Allowance",
  fun: "Movies",
  gifts: "Birthday",
  gov: "SSS",
  salary: "13th month",
  side_income: "Freelance",
};

/** BNPL plan lengths offered in Add; 1 is "pay next month". */
const PLAN_MONTHS = [1, 3, 6, 12];

/**
 * Which accounts each type can use: you spend from peso wallets or a BNPL
 * credit line, receive into wallets (dollar ones too, for interest), and move
 * money between any of your accounts.
 */
function usableFor(type: TransactionType, accounts: Account[], keep: (string | null | undefined)[] = []) {
  return accounts.filter(
    (a) =>
      keep.includes(a.id) ||
      (type === "transfer" ? true : type === "income" ? isSpendable(a.type) : paysInPesos(a) || a.type === "credit_line"),
  );
}

/**
 * Where money from `from` can go. Dollars only move between your own cash,
 * banks and e-wallets: credit lines, loans and people are in pesos.
 */
function transferTargets(from: Account | undefined, accounts: Account[], keep: (string | null | undefined)[] = []) {
  return usableFor("transfer", accounts, keep).filter(
    (a) =>
      a.id !== from?.id &&
      (keep.includes(a.id) ||
        ((from?.currency !== "USD" || isSpendable(a.type)) && (a.currency !== "USD" || !from || isSpendable(from.type)))),
  );
}

/** What `amount` in `from`'s currency is in `to`'s, at the rate set on the dollar wallet. Null when they match. */
function converted(amount: number, from: Account | undefined, to: Account | undefined): number | null {
  if (!from || !to || from.currency === to.currency || !amount) return null;
  const usd = from.currency === "USD" ? from : to;
  if (!usd.fxRate) return null;
  return roundCents(from.currency === "USD" ? amount * usd.fxRate : amount / usd.fxRate);
}

const TITLES: Record<TransactionType, string> = {
  expense: "Add expense",
  income: "Add income",
  transfer: "Move money",
};

/** Values to start Add with, e.g. from "Add income" on a scheduled payday. */
export type Prefill = {
  type: "expense" | "income";
  amount: number | null;
  category: string | null;
  accountId: string | null;
  note: string;
  /** "<recurring item id>|<date>": saving logs that occurrence. */
  link: string | null;
};

export function TransactionForm({
  accounts,
  templates,
  transaction,
  today,
  mode,
  closeHref = "/",
  prefill,
  people = [],
  startSplit = false,
  subcategories = {},
}: {
  accounts: Account[];
  templates: Template[];
  /** The transaction being edited; omit to add a new one. */
  transaction?: Transaction;
  today: string;
  /** "modal" closes with router.back(); "page" goes to `closeHref`. */
  mode: "modal" | "page";
  closeHref?: string;
  prefill?: Prefill;
  /** People you have utang or pautang with, for Split. Balance above 0: they owe you. */
  people?: { id: string; name: string; balance?: number }[];
  /** Open with Split on (from "Split a bill"). */
  startSplit?: boolean;
  /** Subcategories typed before, by category key, most used first. */
  subcategories?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(transaction);

  const prefillAccount = accounts.find((a) => a.id === prefill?.accountId);
  const defaultFrom = prefillAccount?.id ?? templates[0]?.accountId ?? accounts[0]?.id ?? "";
  // A dollar wallet's + Add moves money: dollars aren't spent.
  const startType = prefillAccount?.currency === "USD" && prefill?.type === "expense" ? "transfer" : prefill?.type;
  const [type, setType] = useState<TransactionType>(transaction?.type ?? startType ?? "expense");
  const startAmount = transaction?.amount ?? prefill?.amount;
  const [calc, setCalc] = useState<{ expr: string; error: string | null }>({
    expr: startAmount ? amountToExpression(startAmount) : "",
    error: null,
  });
  const prefillCategory = (t: "expense" | "income") =>
    prefill?.type === t && prefill.category ? prefill.category : null;
  const [categories, setCategories] = useState({
    expense: transaction?.type === "expense" ? transaction.category : (prefillCategory("expense") ?? "food"),
    income: transaction?.type === "income" ? transaction.category : (prefillCategory("income") ?? "salary"),
  });
  const [subcategory, setSubcategory] = useState<string | null>(transaction?.subcategory ?? null);
  // Typed here but not saved yet, by category key.
  const [addedSubs, setAddedSubs] = useState<Record<string, string[]>>({});
  const [newSub, setNewSub] = useState("");
  const [accountId, setAccountId] = useState(transaction?.accountId ?? defaultFrom);
  const [toAccountId, setToAccountId] = useState(
    transaction?.toAccountId ?? transferTargets(accounts.find((a) => a.id === defaultFrom), accounts)[0]?.id ?? "",
  );
  // Pesos to dollars or back: what landed, typed or worked out from the wallet's rate.
  const [landed, setLanded] = useState(transaction?.toAmount ? String(transaction.toAmount) : "");
  const [date, setDate] = useState(transaction?.occurredOn ?? today);
  // New: now. Editing: the time picked, else when it was logged. Empty = no time.
  const [time, setTime] = useState(() =>
    transaction ? (transaction.occurredTime ?? (transaction.createdAt ? clockOf(transaction.createdAt) : "")) : clockOf(),
  );
  const [note, setNote] = useState(transaction?.note ?? prefill?.note ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // BNPL payment plan, shown when paying with a credit line.
  const [planMonths, setPlanMonths] = useState(3);
  const [planRate, setPlanRate] = useState("0");
  const [planFirstDue, setPlanFirstDue] = useState<string | null>(null);
  const [planPayFrom, setPlanPayFrom] = useState(accounts.find((a) => paysInPesos(a))?.id ?? "");
  // Split a bill (design canvas row 5).
  const [splitOn, setSplitOn] = useState(startSplit && !transaction);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [newName, setNewName] = useState("");
  // Who paid the bill: "me", a participant's key, or null until you pick.
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [splitMethod, setSplitMethod] = useState<"equal" | "exact">("equal");
  const [exact, setExact] = useState<Record<string, string>>({});
  // Phones: the keypad sheet over the bottom of the form.
  const [padOpen, setPadOpen] = useState(false);
  const amountButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const category = type === "transfer" ? null : categories[type];
  const sub = category ? subcategory : null;
  const subOptions = category ? subcategoryChoices(category, subcategories, addedSubs, sub) : [];
  const value = evaluate(calc.expr);
  const amount = value && value > 0 ? value : 0;
  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const keep = [transaction?.accountId, transaction?.toAccountId];
  // Amounts are in the paying wallet's currency.
  const currency: Currency = account?.currency ?? "PHP";
  const money = (v: number) => formatMoney(v, currency);
  const crossing = type === "transfer" && !!account && !!toAccount && account.currency !== toAccount.currency;
  const suggestedLanded = crossing ? converted(amount, account, toAccount) : null;
  const toAmount = !crossing ? null : landed.trim() ? parseAmount(landed) : suggestedLanded;
  const splitting = splitOn && type === "expense" && !editing;
  const fromList = usableFor(type, accounts, keep);
  // A split you paid with a credit line goes on its bill too, for the whole amount.
  const iPaid = !splitting || paidBy === "me";
  const withPlan = !editing && iPaid && type === "expense" && account?.type === "credit_line";
  const shares = splitting ? splitShares(amount, participants, splitMethod, exact) : null;
  // Exact amounts: what's still to be shared out, counting down to ₱0.
  const leftToSplit =
    splitting && splitMethod === "exact" && participants.length
      ? roundCents(amount - ["me", ...participants.map((p) => p.key)].reduce((s, k) => s + readShare(exact[k]), 0))
      : null;
  const rate = Number(planRate);
  const firstDue = planFirstDue ?? (isValidDate(date) ? bnplFirstDue(date, account?.dueDay ?? null, account?.cutoffDay ?? null) : "");
  const planRows =
    withPlan && amount && isValidDate(firstDue) && rate >= 0
      ? buildSchedule({ principal: amount, feeTotal: bnplFee(amount, rate, planMonths), months: planMonths, firstDue })
      : [];

  function close() {
    if (mode === "modal") router.back();
    else router.push(closeHref);
  }

  function pressKey(key: Key) {
    setSaveError(null);
    setCalc((c) => {
      const r = press(c.expr, key);
      return { expr: r.expr, error: r.error ?? null };
    });
  }

  function openPad() {
    setPadOpen(true);
    // After it's no longer inert.
    requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
  }

  /** `refocus`: back to the amount, unless you were scrolling away from it. */
  function closePad(refocus = true) {
    setPadOpen(false);
    if (refocus) amountButtonRef.current?.focus({ preventScroll: true });
  }

  // Phones: scrolling the form, or swiping the keypad down, puts the keypad away.
  const dismissPad = useEffectEvent(() => closePad(false));
  useEffect(() => {
    if (!padOpen) return;
    let startY: number | null = null;
    let onSheet = false;
    const inSheet = (t: EventTarget | null) => t instanceof Node && !!sheetRef.current?.contains(t);
    const touchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? null;
      onSheet = inSheet(e.target);
    };
    const touchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (startY === null || y === undefined) return;
      // On the keypad, only a clear swipe down: a tap can wobble a little.
      const dy = y - startY;
      if (onSheet ? dy > 40 : Math.abs(dy) > 8) {
        startY = null;
        dismissPad();
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!inSheet(e.target)) dismissPad();
    };
    document.addEventListener("touchstart", touchStart, { passive: true });
    document.addEventListener("touchmove", touchMove, { passive: true });
    document.addEventListener("wheel", wheel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", touchStart);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("wheel", wheel);
    };
  }, [padOpen]);

  /** Done: slides the keypad away, unless the sum can't be worked out. */
  function donePad() {
    if (value === null) return setCalc((c) => ({ ...c, error: "Can't divide by 0" }));
    if (value < 0) return setCalc((c) => ({ ...c, error: "Amount can't be negative" }));
    setSaveError(null);
    closePad();
  }

  function pickType(next: TransactionType) {
    setType(next);
    setSubcategory(null);
    setSaveError(null);
    const list = usableFor(next, accounts, keep);
    const from = list.some((a) => a.id === accountId) ? accountId : (list[0]?.id ?? "");
    setAccountId(from);
    if (next === "transfer") keepTarget(from);
  }

  /** Keeps To on a wallet `from` can send to. */
  function keepTarget(from: string) {
    const targets = transferTargets(accounts.find((a) => a.id === from), accounts, keep);
    if (!targets.some((a) => a.id === toAccountId)) setToAccountId(targets[0]?.id ?? "");
  }

  function pickTo(id: string) {
    setToAccountId(id);
    setLanded("");
  }

  function pickFrom(id: string) {
    setAccountId(id);
    setPlanFirstDue(null);
    setLanded("");
    keepTarget(id);
  }

  function applyTemplate(t: Template) {
    setType(t.type);
    setCalc({ expr: amountToExpression(t.amount), error: null });
    if (t.type !== "transfer" && t.category) {
      setCategories((c) => ({ ...c, [t.type]: t.category }));
    }
    setSubcategory(t.subcategory);
    setAccountId(t.accountId);
    if (t.toAccountId) setToAccountId(t.toAccountId);
    setNote(t.note ?? "");
    setSaveError(null);
  }

  function submit() {
    if (pending) return;
    if (value === null) {
      setCalc((c) => ({ ...c, error: "Can't divide by 0" }));
      return;
    }
    if (value < 0) {
      setCalc((c) => ({ ...c, error: "Amount can't be negative" }));
      return;
    }
    if (!amount) {
      setSaveError(`Enter an amount above ${currencySymbol(currency)}0.`);
      return;
    }
    if (crossing && !(toAmount !== null && toAmount > 0)) {
      setSaveError(`Type how much landed in ${toAccount!.name}, in ${toAccount!.currency === "USD" ? "dollars" : "pesos"}.`);
      return;
    }
    if (splitting) {
      if (!participants.length) {
        setSaveError("Pick who you split it with.");
        return;
      }
      if (!shares?.ok) {
        setSaveError(shares?.problem ?? "Check the shares.");
        return;
      }
      if (paidBy === null) {
        setSaveError("Pick who paid the bill.");
        return;
      }
      if (withPlan && !(rate >= 0 && rate <= 10)) {
        setSaveError("Check the monthly fee (0 to 10%).");
        return;
      }
      const whoOf = (p: Participant) => (p.personId ? { personId: p.personId } : { name: p.name });
      const payer = participants.find((p) => p.key === paidBy);
      startTransition(async () => {
        const result = await saveSplit({
          total: amount,
          category: category ?? "other",
          subcategory: sub,
          note,
          occurredOn: date,
          paidBy: payer ? whoOf(payer) : null,
          walletId: payer ? null : accountId,
          myShare: shares.mine,
          others: participants.map((p) => ({ who: whoOf(p), amount: shares.byKey[p.key] ?? 0 })),
          plan: withPlan ? { months: planMonths, ratePerMonth: rate, firstDue, payFromAccountId: planPayFrom || null } : null,
        });
        if (result.error) setSaveError(result.error);
        else close();
      });
      return;
    }
    if (withPlan && !(rate >= 0 && rate <= 10)) {
      setSaveError("Check the monthly fee (0 to 10%).");
      return;
    }
    startTransition(async () => {
      const input = {
        type,
        amount,
        accountId,
        toAccountId: type === "transfer" ? toAccountId : null,
        toAmount: crossing ? toAmount : null,
        category,
        subcategory: sub,
        note,
        occurredOn: date,
        occurredTime: time || null,
      };
      if (withPlan) {
        const result = await saveBnplPurchase(
          { ...input, note: note.trim() || sub || categoryInfo("expense", category).label },
          { months: planMonths, ratePerMonth: rate, firstDue, payFromAccountId: planPayFrom || null },
        );
        if (result.error) setSaveError(result.error);
        else close();
        return;
      }
      const result = await saveTransaction(
        input,
        transaction?.id,
        // The link only holds for the type it was opened with.
        prefill?.link && type === prefill.type ? prefill.link : undefined,
      );
      if (result.error) setSaveError(result.error);
      else close();
    });
  }

  function remove() {
    if (!transaction) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteTransaction(transaction.id);
      if (result.error) setSaveError(result.error);
      else close();
    });
  }

  // Keyboard: digits, + − * /, Enter saves, Backspace, Esc closes.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      if (padOpen) {
        // Close just the keypad, not the whole form.
        e.preventDefault();
        closePad();
        return;
      }
      // The modal's dialog handles Esc itself.
      if (mode === "page") close();
      return;
    }
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Enter") {
      if (target?.closest("button, a")) return;
      e.preventDefault();
      if (padOpen) donePad();
      else submit();
      return;
    }
    const key = keyFromKeyboard(e.key);
    if (key) {
      e.preventDefault();
      pressKey(key);
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!accounts.length) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <Pong mood="ask" size={110} decorative />
        <p className="max-w-sm text-base leading-relaxed text-muted">
          Add a wallet first, like Cash or GCash, so I know where the money comes from.
        </p>
        <Link href="/money" className="flex h-12 items-center rounded-[18px] bg-sun px-5 font-extrabold text-ink">
          Add a wallet
        </Link>
        <button type="button" onClick={close} className="h-11 font-extrabold text-sea-dark">
          Close
        </button>
      </div>
    );
  }

  const payer = splitting ? participants.find((p) => p.key === paidBy) : undefined;
  // They paid and already owe you: your share comes off what they owe.
  const payerOwes = payer?.personId ? Math.max(0, people.find((x) => x.id === payer.personId)?.balance ?? 0) : 0;
  const pong = splitting
    ? splitPong(amount, shares, participants, paidBy, payerOwes)
    : pongSays({ type, amount, error: calc.error, account, toAccount, toAmount, transaction, planRows });

  function toggleSplit(on: boolean) {
    setSplitOn(on);
    setSaveError(null);
  }

  function toggleParticipant(p: Participant) {
    setParticipants((list) => (list.some((x) => x.key === p.key) ? list.filter((x) => x.key !== p.key) : [...list, p]));
    if (paidBy === p.key) setPaidBy(null);
  }

  function pickCategory(key: string) {
    if (key !== category) setSubcategory(null);
    setCategories((cs) => ({ ...cs, [type]: key }));
  }

  /** Picks what's typed in the subcategory box, adding it to the chips if it's new. */
  function addSubcategory() {
    const name = cleanSubcategory(newSub)?.slice(0, SUBCATEGORY_MAX);
    if (!name || !category) return;
    const existing = subOptions.find((o) => o.toLowerCase() === name.toLowerCase());
    if (!existing) setAddedSubs((a) => ({ ...a, [category]: [...(a[category] ?? []), name] }));
    setSubcategory(existing ?? name);
    setNewSub("");
    setSaveError(null);
  }

  function addNewName() {
    const name = newName.replace(/\s+/g, " ").trim();
    if (!name) return;
    const existing = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const p = existing ? { key: `p:${existing.id}`, personId: existing.id, name: existing.name } : { key: `n:${name.toLowerCase()}`, personId: null, name };
    if (!participants.some((x) => x.key === p.key)) setParticipants((list) => [...list, p]);
    setNewName("");
  }
  const title = editing ? "Edit transaction" : TITLES[type];
  const saveLabel = pending
    ? splitting ? "Splitting…" : editing ? "Updating…" : "Saving…"
    : !amount
      ? "Enter an amount"
      : splitting
        ? `Split ${formatPeso(amount)}`
        : `${editing ? "Update" : "Enter"} ${money(amount)}`;
  const transferWallets = transferTargets(account, accounts, keep);

  const typePicker = (className: string) => (
    <div role="group" aria-label="Type" className={`gap-1 rounded-2xl bg-card p-1 ${className}`}>
      {TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={type === t.value}
          onClick={() => pickType(t.value)}
          className={`h-[34px] rounded-xl px-3 text-sm ${
            type === t.value ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const walletChips = (selected: string, onPick: (id: string) => void, list: Account[], label: string) => (
    <div role="group" aria-label={label} className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
      {list.map((a) => (
        <button
          key={a.id}
          type="button"
          aria-pressed={selected === a.id}
          onClick={() => onPick(a.id)}
          className={`h-9 shrink-0 rounded-full px-3.5 text-sm font-extrabold ${
            selected === a.id ? "bg-ink text-mint" : "bg-card text-ink hover:bg-sea-tint"
          }`}
        >
          {a.name}
        </button>
      ))}
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={`flex flex-col gap-3 lg:flex-row lg:gap-7 ${mode === "modal" ? "px-5 pt-3 lg:p-7" : ""}`}
    >
      {/* Left column from lg up: amount and keypad. Below lg both columns
          dissolve into one list ordered by the order-* classes. */}
      <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-3.5">
        <div className="order-1 hidden items-center justify-between lg:order-none lg:flex">
          <h2 className="font-display text-[26px] font-semibold">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-card">
            <CloseIcon size={18} />
          </button>
        </div>

        <div aria-live="polite" className="relative order-2 flex flex-col items-center rounded-[22px] bg-card px-4 py-2 lg:order-none lg:items-end lg:px-[18px] lg:py-3.5">
          {/* Phones: the amount opens the keypad sheet. */}
          <button
            ref={amountButtonRef}
            type="button"
            onClick={openPad}
            aria-label={amount ? `Amount ${money(amount)}. Tap to change.` : "Type the amount"}
            aria-expanded={padOpen}
            aria-controls="keypad-sheet"
            className="absolute inset-0 rounded-[22px] outline-none focus-visible:ring-2 focus-visible:ring-sea lg:hidden"
          />
          <span className="min-h-6 text-[17px] font-bold text-muted">
            {hasOperator(calc.expr) ? prettyExpression(calc.expr) : " "}
          </span>
          <span className="font-display text-[52px] leading-[1.05] font-semibold">
            {money(Math.max(0, value ?? 0))}
          </span>
          <span
            className={`min-h-5 text-sm font-bold ${
              calc.error || (leftToSplit !== null && leftToSplit < 0)
                ? "text-coral-text"
                : leftToSplit === 0
                  ? "text-sea-dark"
                  : "text-muted"
            }`}
          >
            {calc.error ??
              (leftToSplit === null || !amount
                ? summary({ type, category, subcategory: sub, account, toAccount, date, today })
                : splitLeftLabel(leftToSplit))}
          </span>
        </div>

        <Keypad onPress={pressKey} className="hidden grid-rows-[repeat(5,58px)] lg:grid" />

        {/* Phones: the keypad slides up from the bottom when you tap the
            amount, and back down on Done, a tap above it, a swipe down or a
            scroll, so the rest of the form is in view. Scrolling over the
            dimmed part still scrolls the form underneath. */}
        <div
          aria-hidden="true"
          onClick={() => closePad()}
          className={`fixed inset-0 z-40 bg-scrim/40 transition-opacity duration-300 lg:hidden ${
            padOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
        <div
          id="keypad-sheet"
          ref={sheetRef}
          role="group"
          aria-label="Amount keypad"
          tabIndex={-1}
          inert={!padOpen}
          className={`fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2.5 rounded-t-[28px] bg-mint px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(18,48,42,0.25)] outline-none touch-none transition-[translate,visibility] duration-300 ease-out lg:hidden ${
            padOpen ? "visible translate-y-0" : "invisible translate-y-full"
          }`}
        >
          <span aria-hidden="true" className="mx-auto h-1.5 w-10 rounded-full bg-line" />
          <div className="flex flex-col items-end rounded-[20px] bg-card px-4 py-2">
            <span className="min-h-5 text-[15px] font-bold text-muted">
              {hasOperator(calc.expr) ? prettyExpression(calc.expr) : " "}
            </span>
            <span className="font-display text-[36px] leading-[1.05] font-semibold">{money(Math.max(0, value ?? 0))}</span>
            <span className={`min-h-5 text-[13px] font-bold ${calc.error ? "text-coral-text" : "text-muted"}`}>
              {calc.error ?? "Add them up, like 120 + 45 + 20."}
            </span>
          </div>
          <Keypad onPress={pressKey} className="grid-rows-[repeat(5,50px)]" />
          <button type="button" onClick={donePad} className="h-14 rounded-[18px] bg-sun text-[17px] font-extrabold text-ink">
            {amount ? `Done · ${money(amount)}` : "Done"}
          </button>
        </div>

        <p className="hidden flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-muted lg:flex">
          <strong className="text-ink">Keyboard works too:</strong>
          <span>0–9 and .</span>
          <span>+ − * /</span>
          <span>Enter = save</span>
          <span>Backspace</span>
          <span>Esc = close</span>
        </p>
      </div>

      {/* Right column from lg up: what it was for and where it came from. */}
      <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-4">
        <div className="order-0 flex h-11 items-center justify-between lg:hidden">
          <button type="button" onClick={close} className="w-16 text-left font-bold text-sea">
            Cancel
          </button>
          {typePicker("flex")}
          <span className="w-16" aria-hidden="true" />
        </div>
        <h2 className="sr-only lg:hidden">{title}</h2>
        {typePicker("hidden self-start lg:flex")}

        <div className="order-3 flex min-h-14 items-center gap-2 rounded-[18px] bg-card py-1 pr-3 pl-1 lg:order-none lg:min-h-[68px] lg:rounded-[20px]">
          <Pong mood={pong.mood} size={52} decorative />
          <p className="text-sm leading-snug lg:text-[15px]">{pong.line}</p>
        </div>

        {!editing && templates.length > 0 && (
          <div className="order-4 flex flex-col gap-1.5 lg:order-none">
            <span id="recent-label" className="text-xs font-extrabold text-muted">RECENT · TAP TO REUSE</span>
            <div role="group" aria-labelledby="recent-label" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
              {templates.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="h-9 shrink-0 rounded-full border-2 border-dashed border-line bg-card px-3 text-[13px] font-bold hover:border-sea"
                >
                  {templateLabel(t, accounts)}
                </button>
              ))}
            </div>
          </div>
        )}

        {type !== "transfer" && (
          <div className="order-5 flex flex-col gap-1.5 lg:order-none">
            <span id="category-label" className="hidden text-sm font-extrabold lg:block">Category</span>
            <div role="group" aria-label="Category" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
              {categoriesFor(type).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={category === c.key}
                  onClick={() => pickCategory(c.key)}
                  className={`flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-2xl border-[2.5px] bg-card px-1 py-1.5 text-xs font-extrabold lg:w-auto ${
                    category === c.key ? "border-sea" : "border-transparent"
                  }`}
                >
                  <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-xl ${c.tint}`}>
                    <PathIcon d={c.icon} size={19} />
                  </span>
                  <span className="max-w-full truncate">{c.label}</span>
                </button>
              ))}
            </div>
            {category && (
              <div className="flex flex-col gap-1.5">
                <span id="subcategory-label" className="text-[13px] font-extrabold text-muted">
                  {categoryInfo(type, category).label.toUpperCase()} · SUBCATEGORY (OPTIONAL)
                </span>
                {subOptions.length > 0 && (
                  <div role="group" aria-labelledby="subcategory-label" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
                    {subOptions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={sub === name}
                        onClick={() => setSubcategory(sub === name ? null : name)}
                        className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-extrabold ${
                          sub === name ? "bg-ink text-mint" : "bg-card text-ink hover:bg-sea-tint"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <label htmlFor="subcategory-new" className="sr-only">New subcategory</label>
                  <input
                    id="subcategory-new"
                    value={newSub}
                    onChange={(e) => setNewSub(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSubcategory();
                      }
                    }}
                    maxLength={SUBCATEGORY_MAX}
                    placeholder={`New subcategory${SUBCATEGORY_EXAMPLES[category] ? `, like ${SUBCATEGORY_EXAMPLES[category]}` : ""}`}
                    className="h-10 min-w-0 flex-1 rounded-[14px] bg-card px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
                  />
                  <button
                    type="button"
                    onClick={addSubcategory}
                    disabled={!newSub.trim()}
                    className="h-10 rounded-[14px] bg-card px-3.5 text-sm font-extrabold disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
            {category === "groceries" && !editing && (
              <Link href="/grocery" className="text-[13px] font-extrabold text-sea-dark underline">
                At the store now? Scan as you shop in Grocery mode
              </Link>
            )}
          </div>
        )}

        {type === "expense" && !editing && (
          <div className="order-6 flex flex-col gap-2.5 rounded-[18px] bg-card p-3.5 lg:order-none">
            <label className="flex items-center justify-between gap-3 text-sm font-extrabold">
              Split this bill
              <input type="checkbox" checked={splitOn} onChange={(e) => toggleSplit(e.target.checked)} className="h-6 w-6 accent-sea" />
            </label>
            {splitting && (
              <>
                <span id="split-with-label" className="text-[13px] font-extrabold text-muted">SPLIT WITH</span>
                <div role="group" aria-labelledby="split-with-label" className="flex flex-wrap gap-2">
                  {[
                    ...people.map((p) => ({ key: `p:${p.id}`, personId: p.id, name: p.name })),
                    ...participants.filter((p) => !p.personId),
                  ].map((p) => {
                    const on = participants.some((x) => x.key === p.key);
                    return (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleParticipant(p)}
                        className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${on ? "bg-ink text-mint" : "bg-mint text-ink hover:bg-sea-tint"}`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <label htmlFor="split-new" className="sr-only">Add someone</label>
                  <input
                    id="split-new"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addNewName();
                      }
                    }}
                    maxLength={60}
                    placeholder="Add someone"
                    className="h-10 min-w-0 flex-1 rounded-[14px] bg-mint px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
                  />
                  <button type="button" onClick={addNewName} className="h-10 rounded-[14px] bg-mint px-3.5 text-sm font-extrabold">
                    Add
                  </button>
                </div>
                {participants.length > 0 && (
                  <>
                    <span id="split-paid-label" className="text-[13px] font-extrabold text-muted">WHO PAID?</span>
                    <div role="group" aria-labelledby="split-paid-label" className="flex flex-wrap gap-2">
                      {[{ key: "me", name: "Me" }, ...participants].map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          aria-pressed={paidBy === p.key}
                          onClick={() => setPaidBy(p.key)}
                          className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${paidBy === p.key ? "bg-ink text-mint" : "bg-mint text-ink hover:bg-sea-tint"}`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                    <div role="group" aria-label="How to split" className="grid grid-cols-2 gap-1 rounded-xl bg-mint p-1">
                      {(["equal", "exact"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={splitMethod === m}
                          onClick={() => setSplitMethod(m)}
                          className={`h-8 rounded-lg text-sm ${splitMethod === m ? "bg-card font-extrabold" : "font-bold text-muted"}`}
                        >
                          {m === "equal" ? "Split equally" : "Exact amounts"}
                        </button>
                      ))}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {[{ key: "me", name: "You" }, ...participants].map((p) => (
                        <li key={p.key} className="flex items-center justify-between gap-3 text-[15px]">
                          <span className="font-bold">{p.name}</span>
                          {splitMethod === "exact" ? (
                            <AmountInput
                              aria-label={`${p.name}'s share`}
                              value={exact[p.key] ?? ""}
                              onChange={(v) => setExact((x) => ({ ...x, [p.key]: v }))}
                              placeholder="0.00"
                              wrapperClassName="w-32"
                              className="h-9 w-full rounded-[12px] bg-mint px-3 text-right text-[15px] outline-none focus:ring-2 focus:ring-sea"
                            />
                          ) : (
                            <span className="font-display font-semibold">
                              {formatPeso(p.key === "me" ? (shares?.mine ?? 0) : (shares?.byKey[p.key] ?? 0))}
                            </span>
                          )}
                        </li>
                      ))}
                      {leftToSplit !== null && (
                        <li
                          aria-live="polite"
                          className={`mt-1 flex items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-[15px] ${
                            leftToSplit === 0 ? "bg-sea-tint text-sea-dark" : leftToSplit < 0 ? "bg-coral-tint text-coral-text" : "bg-mint"
                          }`}
                        >
                          <span className="font-extrabold">
                            {leftToSplit === 0 ? "✓ Adds up to the bill" : leftToSplit < 0 ? "Over the bill by" : "Left to split"}
                          </span>
                          <span className="text-right">
                            <span className="font-display font-semibold">
                              {formatPeso(leftToSplit === 0 ? amount : Math.abs(leftToSplit))}
                            </span>
                            {leftToSplit !== 0 && <span className="block text-xs text-muted">of {formatPeso(amount)}</span>}
                          </span>
                        </li>
                      )}
                    </ul>
                    <p className={`text-xs ${paidBy === null ? "font-bold text-coral-text" : "text-muted"}`}>
                      {paidBy === null
                        ? "Pick who paid the bill."
                        : payer
                          ? payerOwes > 0 && shares?.ok
                            ? deductionText(payer.name, payerOwes, shares.mine)
                            : `${payer.name} paid: your share is spending, and you'll owe it to ${payer.name}.`
                          : "You paid: only your share is spending. The rest is pautang, still your money."}
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {iPaid && (
          <div className="order-6 flex flex-col gap-1.5 lg:order-none">
            <span className="text-sm font-extrabold">
              {type === "expense" ? "Pay with" : type === "income" ? "Received in" : "From"}
            </span>
            {walletChips(accountId, pickFrom, fromList, type === "expense" ? "Pay with" : type === "income" ? "Received in" : "From")}
          </div>
        )}

        {withPlan && (
          <div className="order-7 flex flex-col gap-2.5 rounded-[18px] bg-card p-3.5 lg:order-none">
            <span id="plan-label" className="text-sm font-extrabold">Payment plan</span>
            <div role="group" aria-labelledby="plan-label" className="flex flex-wrap gap-2">
              {PLAN_MONTHS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={planMonths === m}
                  onClick={() => setPlanMonths(m)}
                  className={`h-9 rounded-full px-3.5 text-sm font-extrabold ${planMonths === m ? "bg-ink text-mint" : "bg-mint text-ink hover:bg-sea-tint"}`}
                >
                  {m === 1 ? "Pay next month" : `${m} months`}
                </button>
              ))}
            </div>
            {/* Fee and first due side by side, Pay from under them: three across cut off the date and wallet. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="plan-rate" className="text-[13px] font-extrabold">Fee % / mo</label>
                <input
                  id="plan-rate"
                  value={planRate}
                  onChange={(e) => setPlanRate(e.target.value)}
                  inputMode="decimal"
                  className="h-11 min-w-0 rounded-[14px] bg-mint px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="plan-first" className="text-[13px] font-extrabold">First due</label>
                <input
                  id="plan-first"
                  type="date"
                  value={firstDue}
                  onChange={(e) => setPlanFirstDue(e.target.value)}
                  className="h-11 w-full min-w-0 rounded-[14px] bg-mint px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label htmlFor="plan-from" className="text-[13px] font-extrabold">Pay from</label>
                <select
                  id="plan-from"
                  value={planPayFrom}
                  onChange={(e) => setPlanPayFrom(e.target.value)}
                  className="h-11 w-full min-w-0 rounded-[14px] bg-mint px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
                >
                  {accounts.filter((a) => paysInPesos(a)).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted">
              {planRows.length
                ? `${formatPeso(planRows[0].amount)}${planMonths > 1 ? `/mo × ${planMonths}` : ""} from ${formatShortDay(planRows[0].dueOn, today)}` +
                  (planRows.some((r) => r.feePart > 0) ? ` · fees ${formatPeso(planRows.reduce((s, r) => s + r.feePart, 0))}.` : " · no fees.")
                : "Type an amount to see the payments."}
              {splitting
                ? " The whole bill goes on your credit line's bill. Only your share is spending; the rest is pautang."
                : " The purchase counts as spending today; each payment is a transfer, and only fees are spending."}
            </p>
          </div>
        )}

        {type === "transfer" && (
          <div className="order-7 flex flex-col gap-1.5 lg:order-none">
            <span className="text-sm font-extrabold">To</span>
            {transferWallets.length ? (
              walletChips(toAccountId, pickTo, transferWallets, "To")
            ) : (
              <p className="text-sm text-muted">
                Add a second wallet in <Link href="/money" className="font-extrabold text-sea-dark underline">Money</Link> to move money between them.
              </p>
            )}
            {crossing && toAccount && (
              <div className="mt-1 flex flex-col gap-1">
                <label htmlFor="txn-landed" className="text-[13px] font-extrabold">
                  Landed in {toAccount.name}
                </label>
                <div className="relative w-48">
                  <span aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 font-bold text-muted">
                    {currencySymbol(toAccount.currency)}
                  </span>
                  <input
                    id="txn-landed"
                    value={landed}
                    onChange={(e) => {
                      setLanded(e.target.value);
                      setSaveError(null);
                    }}
                    inputMode="decimal"
                    placeholder={suggestedLanded ? String(suggestedLanded) : "0.00"}
                    className="h-11 w-full rounded-[14px] bg-card pr-3 pl-8 text-right text-[15px] outline-none focus:ring-2 focus:ring-sea"
                  />
                </div>
                <span className="text-xs text-muted">
                  {landed.trim()
                    ? "What the bank's app says landed."
                    : suggestedLanded
                      ? `≈ ${formatMoney(suggestedLanded, toAccount.currency)} at the rate on ${
                          account?.currency === "USD" ? account.name : toAccount.name
                        }. Type what the bank's app says if it's different.`
                      : "Type what the bank's app says landed."}
                </span>
              </div>
            )}
            <p className="text-xs text-muted">Moving money between your own wallets is never counted as spending.</p>
          </div>
        )}

        <div className="order-8 grid grid-cols-2 gap-2.5 lg:order-none lg:grid-cols-[minmax(0,1fr)_minmax(0,8.5rem)_minmax(0,1.3fr)]">
          <div className={`flex flex-col gap-1 ${splitting ? "col-span-2" : ""}`}>
            <label htmlFor="txn-date" className="text-[13px] font-extrabold">Date</label>
            <input
              id="txn-date"
              type="date"
              value={date}
              required
              onChange={(e) => setDate(e.target.value)}
              className="h-11 min-w-0 rounded-[14px] bg-card px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
            />
          </div>
          {/* A split saves several records through its own flow, which keeps just the date. */}
          {!splitting && (
            <div className="flex flex-col gap-1">
              <label htmlFor="txn-time" className="text-[13px] font-extrabold">Time</label>
              <input
                id="txn-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                // Now on the server and in the browser can be a minute apart.
                suppressHydrationWarning
                className="h-11 min-w-0 rounded-[14px] bg-card px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
              />
            </div>
          )}
          <div className="col-span-2 flex flex-col gap-1 lg:col-span-1">
            <label htmlFor="txn-note" className="text-[13px] font-extrabold">Note</label>
            <input
              id="txn-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              placeholder="optional"
              className="h-11 min-w-0 rounded-[14px] bg-card px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea"
            />
          </div>
        </div>

        <div className="hidden flex-1 lg:block" />

        <div
          className={`order-10 flex flex-col gap-2 pb-5 lg:order-none lg:pb-0 ${
            mode === "modal" ? "sticky bottom-0 -mx-5 bg-mint px-5 pt-2 lg:static lg:mx-0 lg:px-0 lg:pt-0" : ""
          }`}
        >
          <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{saveError}</p>
          <div className="flex gap-2.5">
            {editing ? (
              <button
                type="button"
                onClick={remove}
                onBlur={() => setConfirmDelete(false)}
                disabled={pending}
                className={`h-14 flex-1 rounded-[18px] font-extrabold ${
                  confirmDelete ? "bg-coral text-white" : "bg-card text-coral-text"
                }`}
              >
                {confirmDelete ? "Tap again to delete" : "Delete"}
              </button>
            ) : (
              <button type="button" onClick={close} className="hidden h-14 flex-1 rounded-[18px] bg-card font-extrabold lg:block">
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={pending}
              className="h-14 flex-[2] rounded-[18px] bg-sun text-[17px] font-extrabold text-ink disabled:opacity-60"
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

type Shares = { ok: boolean; problem?: string; mine: number; byKey: Record<string, number> };

/** A typed share, including a sum still being typed ("50+20"); 0 if it can't be read yet. */
function readShare(text: string | undefined): number {
  if (!text?.trim()) return 0;
  const plain = parseAmount(text);
  if (!Number.isNaN(plain)) return plain;
  const expr = expressionFromText(text);
  const result = expr ? evaluate(expr) : null;
  return result !== null && result > 0 ? roundCents(result) : 0;
}

function splitLeftLabel(left: number): string {
  if (left === 0) return "✓ The shares add up";
  return left > 0 ? `${formatPeso(left)} left to split` : `Shares are ${formatPeso(-left)} over`;
}

/** Each person's share of `total`: equal (you absorb the rounding) or typed in. */
function splitShares(
  total: number,
  participants: Participant[],
  method: "equal" | "exact",
  exact: Record<string, string>,
): Shares {
  if (method === "equal") {
    const [mine, ...others] = equalShares(total, participants.map((p) => p.key));
    return { ok: total > 0, mine: mine.amount, byKey: Object.fromEntries(others.map((s) => [s.personId!, s.amount])) };
  }
  const read = (key: string) => (exact[key]?.trim() ? parseAmount(exact[key]) : 0);
  const mine = read("me");
  const byKey = Object.fromEntries(participants.map((p) => [p.key, read(p.key)]));
  const values = [mine, ...Object.values(byKey)];
  if (values.some((v) => Number.isNaN(v))) return { ok: false, problem: "Check the shares.", mine: 0, byKey };
  const sum = roundCents(values.reduce((s, v) => s + v, 0));
  if (sum !== roundCents(total)) {
    return { ok: false, problem: `The shares add up to ${formatPeso(sum)}, not ${formatPeso(total)}.`, mine, byKey };
  }
  return { ok: true, mine, byKey };
}

/**
 * Someone who owes you paid the bill: your share comes off what they owe
 * (it's the same person's balance), and only the rest is utang.
 */
function deductionText(name: string, owes: number, mine: number): string {
  const left = roundCents(owes - mine);
  const start = `${name} paid and owes you ${formatPeso(owes)}. Your ${formatPeso(mine)} share comes off it:`;
  if (left > 0) return `${start} ${name} will owe you ${formatPeso(left)}.`;
  if (left === 0) return `${start} you're even.`;
  return `${start} that clears it, and you'll owe ${name} ${formatPeso(-left)}.`;
}

function splitPong(
  amount: number,
  shares: Shares | null,
  participants: Participant[],
  paidBy: string | null,
  payerOwes = 0,
): { mood: PongMood; line: string } {
  if (!amount) return { mood: "ask", line: "How much was the whole bill?" };
  if (!participants.length) return { mood: "listen", line: "Who did you split it with?" };
  if (!shares?.ok) return { mood: "worried", line: shares?.problem ?? "Check the shares." };
  if (paidBy === null) return { mood: "ask", line: "Who paid the bill? You, or one of them?" };
  const payer = participants.find((p) => p.key === paidBy);
  if (payer && payerOwes > 0) {
    const left = roundCents(payerOwes - shares.mine);
    return left >= 0
      ? { mood: "happy", line: `I'll take your ${formatPeso(shares.mine)} share off what ${payer.name} owes you. ${left > 0 ? `${formatPeso(left)} left.` : "You're even!"}` }
      : { mood: "listen", line: `That clears what ${payer.name} owes you, and you'll owe ${formatPeso(-left)}.` };
  }
  if (payer) return { mood: "listen", line: `Your share is ${formatPeso(shares.mine)}. I'll note that you owe ${payer.name}.` };
  const owed = roundCents(amount - shares.mine);
  return { mood: "happy", line: `Your share is ${formatPeso(shares.mine)}. ${formatPeso(owed)} becomes pautang, still your money.` };
}

/** Saved subcategories for `category`, then ones typed here, then the picked one if it's in neither. */
function subcategoryChoices(
  category: string,
  saved: Record<string, string[]>,
  added: Record<string, string[]>,
  picked: string | null,
): string[] {
  const list: string[] = [];
  for (const name of [...(saved[category] ?? []), ...(added[category] ?? []), ...(picked ? [picked] : [])]) {
    if (!list.some((n) => n.toLowerCase() === name.toLowerCase())) list.push(name);
  }
  return list;
}

function summary({
  type,
  category,
  subcategory,
  account,
  toAccount,
  date,
  today,
}: {
  type: TransactionType;
  category: string | null;
  subcategory: string | null;
  account?: Account;
  toAccount?: Account;
  date: string;
  today: string;
}) {
  const when = isValidDate(date) ? formatRelativeDay(date, today) : "Pick a date";
  if (type === "transfer") {
    return `${account?.name ?? "?"} → ${toAccount?.name ?? "?"} · ${when}`;
  }
  return `${categoryLabel(type, category, subcategory)} · ${account?.name ?? ""} · ${when}`;
}

function templateLabel(t: Template, accounts: Account[]) {
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "";
  const amount = formatMoney(t.amount, accounts.find((a) => a.id === t.accountId)?.currency);
  if (t.type === "transfer") return `${name(t.accountId)} → ${name(t.toAccountId)} · ${amount}`;
  const what = t.note || t.subcategory || categoryInfo(t.type, t.category).label;
  return `${what} · ${amount} · ${name(t.accountId)}`;
}

/** What Pong says while you type: how the wallet balance changes. */
function pongSays({
  type,
  amount,
  error,
  account,
  toAccount,
  toAmount,
  transaction,
  planRows,
}: {
  type: TransactionType;
  amount: number;
  error: string | null;
  account?: Account;
  toAccount?: Account;
  /** Pesos to dollars or back: what lands in toAccount. */
  toAmount: number | null;
  transaction?: Transaction;
  planRows: { amount: number }[];
}): { mood: PongMood; line: string } {
  if (error) return { mood: "worried", line: `${error}. Check the numbers?` };
  // Each wallet in its own currency.
  const formatPeso = (v: number, a: Account | undefined = account) => formatMoney(v, a?.currency);

  // When editing, the balance already includes the original transaction.
  const before = (a: Account) => a.balance - (transaction ? balanceEffect(transaction, a.id) : 0);

  if (!amount) {
    if (type === "income") return { mood: "happy", line: "Nice! How much came in?" };
    if (type === "transfer") return { mood: "listen", line: "Moving money between your wallets is never spending." };
    return { mood: "ask", line: "Type an amount. You can add them up, like 120 + 45 + 20." };
  }
  if (!account) return { mood: "ask", line: "Which wallet is it?" };

  if (type === "expense" && account.type === "credit_line") {
    const available = account.creditLimit === null ? null : account.creditLimit + before(account);
    if (available !== null && amount > available) {
      return { mood: "worried", line: `That's over your ${account.name} limit. Only ${formatPeso(Math.max(0, available))} is available.` };
    }
    if (planRows.length > 1) {
      return { mood: "listen", line: `${formatPeso(planRows[0].amount)} a month for ${planRows.length} months. I'll put each payment in your forecast.` };
    }
    return { mood: "listen", line: `Counts as spending today. I'll remind you to pay ${account.name} later.` };
  }

  const left = before(account) - amount;
  if (type === "income") {
    return { mood: "proud", line: `${account.name} goes up to ${formatPeso(before(account) + amount)}.` };
  }
  if (type === "transfer") {
    if (left < 0) {
      return { mood: "worried", line: `${account.name} only has ${formatPeso(before(account))}.` };
    }
    if (!toAccount) return { mood: "ask", line: "Where is the money going?" };
    return {
      mood: "listen",
      line: `${account.name} will have ${formatPeso(left)}, ${toAccount.name} ${formatPeso(before(toAccount) + (toAmount ?? amount), toAccount)}. Not spending.`,
    };
  }
  if (left < 0) {
    return { mood: "shocked", line: `That's ${formatPeso(-left)} more than ${account.name} has right now!` };
  }
  return { mood: "happy", line: `${account.name} will have ${formatPeso(left)} left.` };
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  removeScheduled,
  saveScheduled,
  type ScheduledInput,
  type ScheduledRef,
} from "@/app/schedule-actions";
import { AmountInput } from "@/components/amount-input";
import { ChoiceChip, FIELD_CLASS } from "@/components/choice-chip";
import { FormDialog } from "@/components/form-dialog";
import { PathIcon } from "@/components/icons";
import { LogButton } from "@/components/log-button";
import { categoriesFor, categoryInfo } from "@/lib/categories";
import type { Account, PlannedExpense, RecurringItem } from "@/lib/data";
import { addDays, formatRelativeDay, formatShortDay } from "@/lib/dates";
import type { ForecastItem } from "@/lib/forecast";
import { formatPeso, parseAmount } from "@/lib/money";
import { WEEKDAYS, describeSchedule, hasOwnAmounts, type Frequency } from "@/lib/schedule";

type Repeat = "once" | Frequency;

const REPEATS: { value: Repeat; label: string }[] = [
  { value: "once", label: "One time" },
  { value: "monthly", label: "Monthly" },
  { value: "twice_monthly", label: "Twice a month" },
  { value: "weekly", label: "Weekly" },
];

const IDEAS = {
  in: ["Payroll", "Allowance", "Freelance", "13th month pay", "Rental income"],
  out: ["Rent", "Tuition", "Insurance", "Subscriptions", "Padala"],
};

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function dayLabel(day: number) {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return day >= 29 ? `${day}${suffix} (or last day)` : `${day}${suffix}`;
}

/** One row in the lists: a recurring item or a one-off planned one. */
type Row = {
  ref: ScheduledRef;
  flow: "in" | "out";
  name: string;
  amount: number | null;
  category: string;
  accountId: string | null;
  when: string;
  /** The next occurrence, if one falls in the next 45 days. */
  next: ForecastItem | null;
  payday: boolean;
  /** The payroll calculator works this one out. */
  fromPayroll: boolean;
  input: ScheduledInput;
};

export function ScheduledManager({
  accounts,
  recurring,
  planned,
  items,
  payroll,
  today,
  startEditing = null,
}: {
  accounts: Account[];
  recurring: RecurringItem[];
  planned: PlannedExpense[];
  items: ForecastItem[];
  /** The payroll calculator works out each payday. */
  payroll: boolean;
  today: string;
  /** An item's id from ?edit=: its form opens first. */
  startEditing?: string | null;
}) {
  const [editing, setEditingState] = useState<string | null>(startEditing);
  function setEditing(id: string | null) {
    setEditingState(id);
    // Opened from a link (?edit=…): drop it once closed, so a reload doesn't open it again.
    if (id === null && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("edit")) {
        url.searchParams.delete("edit");
        window.history.replaceState(window.history.state, "", url);
      }
    }
  }
  const [adding, setAdding] = useState<"in" | "out" | null>(null);

  const editingRow = (id: string | null) => rows.find((r) => r.ref.id === id) ?? null;
  const nextOf = (id: string) => items.find((i) => i.id === id && !i.transactionId) ?? items.find((i) => i.id === id) ?? null;

  const rows: Row[] = [
    ...recurring.map((r): Row => {
      const flow = r.kind === "bill" ? "out" : "in";
      const category = r.category ?? (r.kind === "bill" ? "bills" : "salary");
      const payday = r.kind === "payday";
      const next = nextOf(r.id);
      // With the payroll calculator, each payday has its own amount: show the next one.
      const fromPayroll = (payday && payroll) || r.payrollKey !== null;
      return {
        ref: { table: "recurring", id: r.id },
        flow,
        name: payday ? "Payday" : r.name,
        // Paydays that differ each week or each payday: the next one too.
        amount: payday && (payroll || hasOwnAmounts(r)) && next ? next.amount : r.amount,
        category,
        accountId: r.accountId,
        when: describeSchedule(r) + (r.endsOn ? ` until ${formatShortDay(r.endsOn, today)}` : ""),
        next,
        payday,
        fromPayroll,
        input: {
          flow,
          name: r.name,
          amount: r.amount ?? 0,
          amountVaries: r.amountVaries,
          category,
          accountId: r.accountId,
          repeat: r.frequency,
          date: null,
          day1: r.day1,
          day2: r.day2,
          endsOn: r.endsOn,
        },
      };
    }),
    ...planned.map((p): Row => {
      const flow = p.type === "income" ? "in" : "out";
      return {
        ref: { table: "planned", id: p.id },
        flow,
        name: p.name,
        amount: p.amount,
        category: p.category,
        accountId: p.accountId,
        when: p.dueOn < today && !p.transactionId ? `Late, was ${formatShortDay(p.dueOn, today)}` : `Once · ${formatShortDay(p.dueOn, today)}`,
        next: nextOf(p.id),
        payday: false,
        fromPayroll: p.payrollKey !== null,
        input: {
          flow,
          name: p.name,
          amount: p.amount,
          amountVaries: false,
          category: p.category,
          accountId: p.accountId,
          repeat: "once",
          date: p.dueOn,
          day1: 15,
          day2: null,
          endsOn: null,
        },
      };
    }),
  ];

  const section = (flow: "in" | "out") => {
    const list = rows.filter((r) => r.flow === flow);
    const monthly = list.reduce((sum, r) => sum + monthlyAmount(r, recurring), 0);
    const title = flow === "in" ? "Money coming in" : "Money going out";
    return (
      <section aria-labelledby={`${flow}-heading`} className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={`${flow}-heading`} className="font-display text-xl font-semibold">{title}</h2>
          {monthly > 0 && (
            <span className="text-sm font-bold text-muted">
              about {formatPeso(Math.round(monthly))}/mo recurring
            </span>
          )}
        </div>
        <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1.5">
          {list.map((row) => (
            <li key={row.ref.id} className="border-b border-line-soft py-2.5 last:border-0">
              <ItemRow row={row} accounts={accounts} today={today} onEdit={() => setEditing(row.ref.id)} />
            </li>
          ))}
          {!list.length && (
            <li className="py-3 text-[15px] text-muted">
              {flow === "in"
                ? "Nothing yet. Add payroll, an allowance or any income you expect."
                : "Nothing yet. Add rent, tuition, subscriptions or a big expense you see coming."}
            </li>
          )}
        </ul>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setAdding(flow);
            setEditing(null);
          }}
          className="h-[52px] rounded-[20px] border-2 border-dashed border-line font-extrabold text-ink hover:bg-card"
        >
          {flow === "in" ? "+ Add income" : "+ Add expense"}
        </button>
      </section>
    );
  };

  const edited = editingRow(editing);

  return (
    <div className="flex flex-col gap-6">
      {edited && (
        <FormDialog title={`Edit ${edited.name}`} onClose={() => setEditing(null)}>
          <ScheduledForm
            accounts={accounts}
            initial={edited.input}
            existing={edited.ref}
            today={today}
            onClose={() => setEditing(null)}
          />
        </FormDialog>
      )}
      {adding && (
        <FormDialog title={adding === "in" ? "Add income" : "Add expense"} onClose={() => setAdding(null)}>
          <ScheduledForm accounts={accounts} initial={blankInput(adding, today)} today={today} onClose={() => setAdding(null)} />
        </FormDialog>
      )}
      <p className="text-[15px] leading-relaxed text-muted">
        Everything you expect to come in or go out, once or on repeat. It all counts in your
        forecast. When the day comes, tap <strong className="text-ink">Add income</strong> or{" "}
        <strong className="text-ink">Mark paid</strong> to log it in one go.
      </p>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
        {section("in")}
        {section("out")}
      </div>
    </div>
  );
}

/** Roughly what a recurring row adds up to in a month; one-offs count 0. */
function monthlyAmount(row: Row, recurring: RecurringItem[]): number {
  if (row.ref.table !== "recurring" || !row.amount) return 0;
  const r = recurring.find((x) => x.id === row.ref.id)!;
  const times = r.frequency === "weekly" ? 52 / 12 : r.frequency === "twice_monthly" ? 2 : 1;
  return row.amount * times;
}

function blankInput(flow: "in" | "out", today: string): ScheduledInput {
  return {
    flow,
    name: "",
    amount: 0,
    amountVaries: false,
    category: flow === "in" ? "salary" : "bills",
    accountId: null,
    repeat: "monthly",
    date: addDays(today, 7),
    day1: 15,
    day2: 30,
    endsOn: null,
  };
}

function ItemRow({
  row,
  accounts,
  today,
  onEdit,
}: {
  row: Row;
  accounts: Account[];
  today: string;
  onEdit: () => void;
}) {
  const info = categoryInfo(row.flow === "in" ? "income" : "expense", row.category);
  const wallet = accounts.find((a) => a.id === row.accountId);
  const next = row.next;
  const soon = next && next.dueOn < addDays(today, 8);
  const detail = [
    row.when,
    next && !row.input.date && `next ${formatRelativeDay(next.dueOn, today)}`,
    wallet && `${row.flow === "in" ? "to" : "from"} ${wallet.name}`,
    row.fromPayroll && "from payroll calculator",
  ]
    .filter(Boolean)
    .join(" · ");
  // A payroll payday is an estimate until its cutoff is saved and over.
  const estimate = row.payday && row.fromPayroll ? (next?.estimate ?? true) : row.input.amountVaries;
  const linkClass = "flex h-10 items-center rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] ${info.tint}`}>
        <PathIcon d={info.icon} size={21} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{row.name}</span>
        <span className="text-[13px] text-muted">{detail}</span>
      </span>
      <span className={`font-display text-[17px] font-semibold ${row.flow === "in" ? "text-sea" : ""}`}>
        {row.amount === null ? "₱?" : `${row.flow === "in" ? "+" : "−"}${formatPeso(row.amount)}`}
        {estimate && <span className="text-xs font-bold text-muted"> est.</span>}
      </span>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {next && soon && <LogButton item={next} accounts={accounts} />}
        {row.payday ? (
          // With the calculator, how you're paid and each payday's amount are set there.
          <Link
            href={row.fromPayroll ? "/payroll" : "/settings/payday"}
            aria-label={row.fromPayroll ? "Edit payday in the payroll calculator" : undefined}
            className={linkClass}
          >
            Edit
          </Link>
        ) : row.fromPayroll ? (
          // SSS, PhilHealth, Pag-IBIG and tax are worked out by the payroll calculator.
          <Link href="/payroll" aria-label={`Edit ${row.name} in the payroll calculator`} className={linkClass}>
            Edit
          </Link>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${row.name}`}
            className="h-10 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-mint"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

function ScheduledForm({
  accounts,
  initial,
  existing,
  today,
  onClose,
}: {
  accounts: Account[];
  initial: ScheduledInput;
  /** The saved item being edited; omit to add one. */
  existing?: ScheduledRef;
  today: string;
  onClose: () => void;
}) {
  const [flow, setFlow] = useState(initial.flow);
  const [name, setName] = useState(initial.name);
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount) : "");
  const [varies, setVaries] = useState(initial.amountVaries);
  const [categories, setCategories] = useState({
    in: initial.flow === "in" ? initial.category : "salary",
    out: initial.flow === "out" ? initial.category : "bills",
  });
  const [accountId, setAccountId] = useState(initial.accountId ?? "");
  const [repeat, setRepeat] = useState<Repeat>(initial.repeat);
  const [date, setDate] = useState(initial.date ?? addDays(today, 7));
  const [monthDay, setMonthDay] = useState(initial.repeat === "monthly" ? initial.day1 : 15);
  const [twice, setTwice] = useState<[number, number]>(
    initial.repeat === "twice_monthly" ? [initial.day1, initial.day2!] : [15, 30],
  );
  const [weekday, setWeekday] = useState(initial.repeat === "weekly" ? initial.day1 : 5);
  const [endsOn, setEndsOn] = useState(initial.endsOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  const key = existing?.id ?? `new-${initial.flow}`;
  const category = categories[flow];
  const type = flow === "in" ? "income" : "expense";
  const unusedIdeas = IDEAS[flow].filter((idea) => idea.toLowerCase() !== name.trim().toLowerCase());

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = parseAmount(amount);
    if (!(value > 0)) {
      setError("Enter an amount above ₱0. A guess is fine.");
      return;
    }
    let day1 = monthDay;
    let day2: number | null = null;
    if (repeat === "twice_monthly") {
      [day1, day2] = [...twice].sort((a, b) => a - b);
      if (day1 === day2) {
        setError("Pick two different days.");
        return;
      }
    } else if (repeat === "weekly") {
      day1 = weekday;
    }
    const input: ScheduledInput = {
      flow,
      name,
      amount: value,
      amountVaries: repeat !== "once" && varies,
      category,
      accountId: accountId || null,
      repeat,
      date: repeat === "once" ? date : null,
      day1,
      day2,
      endsOn: repeat !== "once" && endsOn ? endsOn : null,
    };
    startTransition(async () => {
      const result = await saveScheduled(input, existing);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  function remove() {
    if (!existing) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    startTransition(async () => {
      const result = await removeScheduled(existing);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  const daySelect = (id: string, value: number, onChange: (v: number) => void, label: string) => (
    <div className="flex flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className={FIELD_CLASS}>
        {DAYS.map((d) => (
          <option key={d} value={d}>{dayLabel(d)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div role="group" aria-label="Income or expense" className="grid grid-cols-2 gap-1 rounded-2xl bg-card p-1">
        {(["in", "out"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={flow === f}
            onClick={() => setFlow(f)}
            className={`h-9 rounded-xl text-sm ${flow === f ? "bg-sea font-extrabold text-white" : "font-bold text-muted hover:text-ink"}`}
          >
            {f === "in" ? "Income" : "Expense"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`sched-name-${key}`} className="text-sm font-bold">Name</label>
          <input
            id={`sched-name-${key}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            placeholder={flow === "in" ? "e.g. Payroll" : "e.g. Rent"}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1 sm:w-44">
          <label htmlFor={`sched-amount-${key}`} className="text-sm font-bold">Amount</label>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-muted">₱</span>
            <AmountInput
              id={`sched-amount-${key}`}
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              className={`${FIELD_CLASS} w-full pl-8 text-right`}
            />
          </div>
        </div>
      </div>

      {!existing && !name.trim() && (
        <div className="flex flex-wrap gap-2">
          {unusedIdeas.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setName(idea)}
              className="h-9 rounded-full bg-card px-3.5 text-sm font-extrabold text-ink hover:bg-sea-tint"
            >
              {idea}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span id={`sched-repeat-${key}`} className="text-sm font-bold">Repeats</span>
        <div role="group" aria-labelledby={`sched-repeat-${key}`} className="flex flex-wrap gap-2">
          {REPEATS.map((r) => (
            <ChoiceChip
              key={r.value}
              selected={repeat === r.value}
              onClick={() => setRepeat(r.value)}
            >
              {r.label}
            </ChoiceChip>
          ))}
        </div>
      </div>

      {repeat === "once" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`sched-date-${key}`} className="text-sm font-bold">Date</label>
          <input
            id={`sched-date-${key}`}
            type="date"
            value={date}
            required
            onChange={(e) => setDate(e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
      )}
      {repeat === "monthly" && daySelect(`sched-day-${key}`, monthDay, setMonthDay, "Every")}
      {repeat === "twice_monthly" && (
        <div className="flex gap-3">
          {daySelect(`sched-day1-${key}`, twice[0], (v) => setTwice([v, twice[1]]), "First")}
          {daySelect(`sched-day2-${key}`, twice[1], (v) => setTwice([twice[0], v]), "Second")}
        </div>
      )}
      {repeat === "weekly" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`sched-week-${key}`} className="text-sm font-bold">Every</label>
          <select id={`sched-week-${key}`} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={FIELD_CLASS}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </div>
      )}
      {repeat !== "once" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`sched-ends-${key}`} className="text-sm font-bold">
              Until <span className="font-semibold text-muted">(optional)</span>
            </label>
            <input
              id={`sched-ends-${key}`}
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <label className="flex min-h-12 flex-1 items-center gap-2.5 text-sm font-bold">
            <input type="checkbox" checked={varies} onChange={(e) => setVaries(e.target.checked)} className="h-5 w-5 accent-sea" />
            The amount changes (it&apos;s an estimate)
          </label>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span id={`sched-cat-${key}`} className="text-sm font-bold">Category</span>
        <div role="group" aria-labelledby={`sched-cat-${key}`} className="flex flex-wrap gap-2">
          {categoriesFor(type).map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={category === c.key}
              onClick={() => setCategories((cs) => ({ ...cs, [flow]: c.key }))}
              className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-extrabold ${
                category === c.key ? "bg-ink text-mint" : "bg-card text-ink hover:bg-sea-tint"
              }`}
            >
              <PathIcon d={c.icon} size={16} />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`sched-account-${key}`} className="text-sm font-bold">
            {flow === "in" ? "Goes to" : "Paid from"}
          </label>
          <select id={`sched-account-${key}`} value={accountId} onChange={(e) => setAccountId(e.target.value)} className={FIELD_CLASS}>
            <option value="">Any wallet</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-[14px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60">
          {pending ? "Saving…" : existing ? `Update ${flow === "in" ? "income" : "expense"}` : flow === "in" ? "Add income" : "Add expense"}
        </button>
        <button type="button" onClick={onClose} className="h-11 rounded-[14px] px-4 font-extrabold text-ink hover:bg-card">
          Cancel
        </button>
        {existing && (
          <button
            type="button"
            onClick={remove}
            onBlur={() => setConfirmRemove(false)}
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

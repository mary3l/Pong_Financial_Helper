"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { SUBCATEGORY_MAX, cleanSubcategory, isCategoryFor } from "@/lib/categories";
import { isValidDate, today } from "@/lib/dates";
import { bnplFee, bnplFirstDue, buildSchedule, catchUpDue, loanSchedule, upcomingSchedule } from "@/lib/installments";
import { checkLoan, exactRate } from "@/lib/loan-edit";
import { MAX_AMOUNT, formatPeso, isSpendable, roundCents, type AccountType } from "@/lib/money";
import type { EntryKind } from "@/lib/people";
import { creditTerms, isMissingColumn, pickWallet, savePlan, type Client } from "@/lib/server-writes";
import { typedNote } from "@/lib/splits";

// Phase 4: utang, pautang and split bills. Every one of these is a transfer
// or an expense on the person's account: see 0006_people.sql.

export type PeopleResult = { error?: string; personId?: string };

const FAILED = { error: "Couldn't save that. Please try again." };
const NOTE_MAX = 120;

function cleanName(name: unknown) {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

function cleanNote(note: unknown) {
  return String(note ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) || null;
}

function validAmount(value: number) {
  return Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT;
}

/** Who: an existing person by id, or a new one by name. */
export type Who = { personId: string } | { name: string };

/** The person's account id, adding them first if they're new. */
async function personFor(supabase: Client, who: Who): Promise<string | null> {
  if ("personId" in who) {
    const { data } = await supabase.from("accounts").select("id").eq("id", who.personId).eq("type", "person").maybeSingle();
    return data?.id ?? null;
  }
  const name = cleanName(who.name);
  if (!name || name.length > 60) return null;
  // Reuse someone with the same name instead of adding them twice.
  const { data: existing } = await supabase
    .from("accounts")
    .select("id, archived")
    .eq("type", "person")
    .ilike("name", name.replace(/[%_\\]/g, (c) => `\\${c}`))
    .limit(1)
    .maybeSingle();
  if (existing) {
    if (existing.archived) await supabase.from("accounts").update({ archived: false }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await supabase
    .from("accounts")
    .insert({ name, type: "person", starting_balance: 0 })
    .select("id")
    .single();
  return error ? null : data.id;
}

/** A wallet of yours; with `credit`, a BNPL or bank credit line counts too (paying a bill with it). */
async function isWallet(supabase: Client, id: string, { credit = false } = {}): Promise<boolean> {
  const { data } = await supabase.from("accounts").select("type").eq("id", id).maybeSingle();
  if (!data) return false;
  const type = data.type as AccountType;
  return isSpendable(type) || (credit && type === "credit_line");
}

async function balanceOf(supabase: Client, personId: string): Promise<number | null> {
  const { data } = await supabase.from("account_balances").select("balance").eq("account_id", personId).maybeSingle();
  return data ? Number(data.balance) : null;
}

/** Inserts a transaction and its person entry; removes the transaction if the entry fails. */
async function record(
  supabase: Client,
  row: Record<string, unknown>,
  entry: { personId: string; kind: EntryKind; dueOn?: string | null; countInForecast?: boolean; splitTotal?: number | null },
): Promise<string | null> {
  const { data, error } = await supabase.from("transactions").insert(row).select("id").single();
  if (error) return null;
  const linked = await supabase.from("person_entries").insert({
    transaction_id: data.id,
    person_id: entry.personId,
    kind: entry.kind,
    due_on: entry.dueOn ?? null,
    count_in_forecast: entry.countInForecast ?? false,
    split_total: entry.splitTotal ?? null,
  });
  if (linked.error) {
    await supabase.from("transactions").delete().eq("id", data.id);
    return null;
  }
  return data.id;
}

export type LendInput = {
  /** "lend" = pautang, "borrow" = utang. */
  direction: "lend" | "borrow";
  who: Who;
  amount: number;
  walletId: string;
  occurredOn: string;
  dueOn: string | null;
  countInForecast: boolean;
  note: string;
};

/** Design canvas 5.2: lending is a transfer to the person, borrowing one from them. */
export async function lendOrBorrow(input: LendInput): Promise<PeopleResult> {
  const amount = roundCents(Number(input.amount));
  if (!validAmount(amount)) return { error: "Enter an amount above ₱0." };
  if (!isValidDate(input.occurredOn)) return { error: "Pick a date." };
  if (input.dueOn !== null && !isValidDate(input.dueOn)) return { error: "Check the due date, or leave it blank." };
  if ("name" in input.who && !cleanName(input.who.name)) return { error: "Who is it?" };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await isWallet(supabase, input.walletId))) return { error: "Pick a wallet." };
  const personId = await personFor(supabase, input.who);
  if (!personId) return { error: "Check the name (up to 60 characters)." };

  const lend = input.direction === "lend";
  const txnId = await record(
    supabase,
    {
      type: "transfer",
      amount,
      account_id: lend ? input.walletId : personId,
      to_account_id: lend ? personId : input.walletId,
      note: cleanNote(input.note) ?? (lend ? "Pautang" : "Utang"),
      occurred_on: input.occurredOn,
    },
    {
      personId,
      kind: lend ? "lend" : "borrow",
      dueOn: input.dueOn,
      countInForecast: lend && input.countInForecast && input.dueOn !== null,
    },
  );
  if (!txnId) return FAILED;

  refresh();
  return { personId };
}

/**
 * Money back: they paid you (into `walletId`) or you paid them (from it).
 * Partial payments are fine; more than the balance isn't.
 */
export async function recordPayment(personId: string, amount: number, walletId: string, occurredOn = today()): Promise<PeopleResult> {
  const value = roundCents(Number(amount));
  if (!validAmount(value)) return { error: "Enter an amount above ₱0." };
  if (!isValidDate(occurredOn)) return { error: "Pick a date." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await isWallet(supabase, walletId))) return { error: "Pick a wallet." };
  const balance = await balanceOf(supabase, personId);
  if (balance === null || balance === 0) return { error: "You're all square with them." };
  if (value > Math.abs(balance)) return { error: "That's more than the balance." };

  const theyPay = balance > 0;
  const txnId = await record(
    supabase,
    {
      type: "transfer",
      amount: value,
      account_id: theyPay ? personId : walletId,
      to_account_id: theyPay ? walletId : personId,
      note: theyPay ? "Paid me back" : "Paid back",
      occurred_on: occurredOn,
    },
    { personId, kind: "payment" },
  );
  if (!txnId) return FAILED;

  refresh();
  return { personId };
}

/** From Coming up: settles the whole balance with the wallet picked, or your first one. */
export async function settlePerson(personId: string, walletId?: string): Promise<PeopleResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const [balance, wallet] = await Promise.all([balanceOf(supabase, personId), pickWallet(supabase, null, walletId)]);
  if (!wallet) return { error: walletId ? "Pick a cash, bank or e-wallet." : "Add a wallet first." };
  if (!balance) return {};
  return recordPayment(personId, Math.abs(balance), wallet);
}

/**
 * Forgive what's left. Pautang you forgive becomes an expense (Gifts); utang
 * they forgive becomes income (Gift). Either way the balance goes to 0.
 */
export async function forgive(personId: string): Promise<PeopleResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const balance = await balanceOf(supabase, personId);
  if (!balance) return { error: "There's nothing left to forgive." };

  const txnId = await record(
    supabase,
    {
      type: balance > 0 ? "expense" : "income",
      amount: roundCents(Math.abs(balance)),
      account_id: personId,
      category: balance > 0 ? "gifts" : "gift",
      note: "Forgiven",
      occurred_on: today(),
    },
    { personId, kind: "forgive" },
  );
  if (!txnId) return FAILED;

  refresh();
  return { personId };
}

export type SplitInput = {
  total: number;
  category: string;
  /** Typed in Add, like "Merienda" under Food. */
  subcategory?: string | null;
  note: string;
  occurredOn: string;
  /** Null when you paid. */
  paidBy: Who | null;
  /** The wallet you paid from, when you paid. */
  walletId: string | null;
  /** Your share. */
  myShare: number;
  /** Everyone else's share. */
  others: { who: Who; amount: number }[];
  /** Paid with a credit line: how you'll pay it back. One payment on the next bill if not given. */
  plan?: SplitPlan | null;
};

export type SplitPlan = {
  /** 1 = pay next month in full. */
  months: number;
  /** Fee or interest as a flat % of the bill per month. */
  ratePerMonth: number;
  firstDue: string;
  payFromAccountId: string | null;
};

/** The name a split's payment plan shows on the credit line's bill. */
function planName(note: string | null) {
  return (note ?? "Split bill").slice(0, 60).trim() || "Split bill";
}

/**
 * Split a bill (the Split toggle in Add). You paid: your share is an
 * expense from your wallet and each other share is pautang. Someone else
 * paid: your share is an expense, and utang to them.
 */
export async function saveSplit(input: SplitInput): Promise<PeopleResult> {
  const total = roundCents(Number(input.total));
  const mine = roundCents(Number(input.myShare));
  if (!validAmount(total)) return { error: "Enter an amount above ₱0." };
  if (!isCategoryFor("expense", input.category)) return { error: "Pick a category." };
  if (!isValidDate(input.occurredOn)) return { error: "Pick a date." };
  if (!input.others.length) return { error: "Pick who you split it with." };
  if (!(mine >= 0) || input.others.some((o) => !(o.amount >= 0))) return { error: "Check the shares." };
  const sum = roundCents(mine + input.others.reduce((s, o) => s + roundCents(o.amount), 0));
  if (sum !== total) return { error: `The shares add up to ₱${sum}, not ₱${total}.` };
  const subcategory = cleanSubcategory(input.subcategory);
  if (subcategory && subcategory.length > SUBCATEGORY_MAX) {
    return { error: `Keep the subcategory to ${SUBCATEGORY_MAX} characters.` };
  }

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  // Only on your share; before migration 0015 there's nowhere to keep it.
  const sub = subcategory ? { subcategory } : {};
  if (subcategory) {
    const { error } = await supabase.from("transactions").select("subcategory").limit(1);
    if (error) return { error: "To save subcategories, run step 15 in supabase/SQL_GUIDE.md first. Or clear the subcategory." };
  }
  const note = cleanNote(input.note);
  const created: string[] = [];
  const undo = async () => {
    if (created.length) await supabase.from("transactions").delete().in("id", created);
  };

  if (input.paidBy === null) {
    if (!input.walletId || !(await isWallet(supabase, input.walletId, { credit: true }))) return { error: "Pick the wallet you paid with." };
    // Paid with SPayLater, Atome or a bank credit line: the whole bill goes on its bill.
    const [wallet] = await creditTerms(supabase, [input.walletId]);
    const credit = wallet?.type === "credit_line";
    const plan = input.plan ?? {
      months: 1,
      ratePerMonth: 0,
      firstDue: bnplFirstDue(input.occurredOn, wallet?.dueDay ?? null, wallet?.cutoffDay ?? null),
      payFromAccountId: null,
    };
    if (credit) {
      if (!Number.isInteger(plan.months) || plan.months < 1 || plan.months > 24) return { error: "Pick how many months." };
      if (!(plan.ratePerMonth >= 0 && plan.ratePerMonth <= 10)) return { error: "Check the monthly fee (0 to 10%)." };
      if (!isValidDate(plan.firstDue) || plan.firstDue < input.occurredOn) {
        return { error: "The first payment can't be before the bill." };
      }
    }
    // One id on every record, so Activity shows the bill as one row.
    const split = (await hasSplitIds(supabase)) ? { split_id: crypto.randomUUID() } : {};
    if (mine > 0) {
      const { data, error } = await supabase
        .from("transactions")
        .insert({
          type: "expense",
          amount: mine,
          account_id: input.walletId,
          category: input.category,
          ...sub,
          note: note ? `${note} (my share)` : "My share",
          occurred_on: input.occurredOn,
          ...split,
        })
        .select("id")
        .single();
      if (error) return FAILED;
      created.push(data.id);
    }
    for (const other of input.others) {
      const amount = roundCents(other.amount);
      if (!amount) continue;
      const personId = await personFor(supabase, other.who);
      const txnId =
        personId &&
        (await record(
          supabase,
          {
            type: "transfer",
            amount,
            account_id: input.walletId,
            to_account_id: personId,
            note: note ? `Split: ${note}` : "Split bill",
            occurred_on: input.occurredOn,
            ...split,
          },
          { personId, kind: "split", splitTotal: total },
        ));
      if (!txnId) {
        await undo();
        return FAILED;
      }
      created.push(txnId);
    }
    if (credit) {
      const payFrom = plan.payFromAccountId && (await isWallet(supabase, plan.payFromAccountId)) ? plan.payFromAccountId : null;
      const saved = await savePlan(supabase, {
        kind: "bnpl",
        accountId: input.walletId,
        name: planName(note),
        principal: total,
        months: plan.months,
        payFromAccountId: payFrom,
        // Your share if you had one: deleting the split deletes the plan too.
        sourceTxnId: created[0],
        rows: buildSchedule({ principal: total, feeTotal: bnplFee(total, plan.ratePerMonth, plan.months), months: plan.months, firstDue: plan.firstDue }),
      });
      if (!saved) {
        await undo();
        return { error: "Couldn't save the payment plan. Please try again." };
      }
    }
  } else {
    const payer = await personFor(supabase, input.paidBy);
    if (!payer) return { error: "Check who paid." };
    if (mine > 0) {
      const txnId = await record(
        supabase,
        {
          type: "expense",
          amount: mine,
          account_id: payer,
          category: input.category,
          ...sub,
          note: note ? `${note} (my share)` : "My share",
          occurred_on: input.occurredOn,
        },
        { personId: payer, kind: "split", splitTotal: total },
      );
      if (!txnId) return FAILED;
    }
  }

  refresh();
  return {};
}

/** False while migration 0012 (transactions.split_id) hasn't been run. */
async function hasSplitIds(supabase: Client): Promise<boolean> {
  const { error } = await supabase.from("transactions").select("split_id").limit(1);
  return !error;
}

/** The payment plan on a credit line that one of these records started, with how many payments are made. */
async function splitPlanOf(supabase: Client, recordIds: string[]) {
  const { data: plan } = await supabase
    .from("installment_plans")
    .select("id, account_id, name, principal, fee_total, months, first_due, pay_from_account_id, source_txn_id")
    .in("source_txn_id", recordIds)
    .limit(1)
    .maybeSingle();
  if (!plan) return null;
  const { data: payments } = await supabase
    .from("scheduled_payments")
    .select("transfer_txn_id, fee_txn_id")
    .eq("plan_id", plan.id);
  const paid = (payments ?? []).filter((p) => p.transfer_txn_id || p.fee_txn_id).length;
  return { ...plan, paid };
}

export type SplitEdit = {
  note: string;
  occurredOn: string;
  /** New amount for each record of the split; 0 removes that share. */
  shares: { id: string; amount: number }[];
};

/**
 * Edits a whole split bill: the note and date on every record, and each
 * share's amount. The bill total is whatever the shares add up to.
 */
export async function updateSplit(splitId: string, input: SplitEdit): Promise<PeopleResult> {
  if (!/^[0-9a-f-]{36}$/i.test(splitId)) return { error: "Couldn't find that split." };
  if (!isValidDate(input.occurredOn)) return { error: "Pick a date." };
  const amounts = new Map(input.shares.map((s) => [s.id, roundCents(Number(s.amount))]));
  if ([...amounts.values()].some((a) => !(a >= 0) || a > MAX_AMOUNT)) return { error: "Check the shares." };
  const total = roundCents([...amounts.values()].reduce((s, a) => s + a, 0));
  if (!validAmount(total)) return { error: "The shares need to add up to more than ₱0." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data: records, error } = await supabase.from("transactions").select("id, type").eq("split_id", splitId);
  if (error || !records?.length) return { error: "Couldn't find that split." };
  if (records.length !== amounts.size || records.some((r) => !amounts.has(r.id))) {
    return { error: "This split changed. Reload and try again." };
  }

  const note = cleanNote(input.note);
  const plan = await splitPlanOf(supabase, records.map((r) => r.id));
  // The plan hangs on one record: move it to one that stays, so taking that share off keeps the plan.
  if (plan && !amounts.get(plan.source_txn_id!)) {
    const kept = records.filter((r) => amounts.get(r.id));
    const to = (kept.find((r) => r.type === "expense") ?? kept[0]).id;
    const { error: moved } = await supabase.from("installment_plans").update({ source_txn_id: to }).eq("id", plan.id);
    if (moved) return FAILED;
    plan.source_txn_id = to;
  }
  for (const r of records) {
    const amount = amounts.get(r.id)!;
    const result = amount
      ? await supabase
          .from("transactions")
          .update({
            amount,
            occurred_on: input.occurredOn,
            note: r.type === "expense" ? (note ? `${note} (my share)` : "My share") : note ? `Split: ${note}` : "Split bill",
          })
          .eq("id", r.id)
      : await supabase.from("transactions").delete().eq("id", r.id);
    if (result.error) return FAILED;
  }
  const kept = records.filter((r) => amounts.get(r.id) && r.type === "transfer").map((r) => r.id);
  if (kept.length) {
    const { error: entries } = await supabase.from("person_entries").update({ split_total: total }).in("transaction_id", kept);
    if (entries) return FAILED;
  }

  if (plan) {
    const principal = Number(plan.principal);
    if (total !== principal && plan.paid === 0) {
      // Nothing paid yet: the bill follows the new total, on the same due dates.
      const saved = await savePlan(supabase, {
        kind: "bnpl",
        accountId: plan.account_id,
        name: planName(note),
        principal: total,
        months: plan.months,
        payFromAccountId: plan.pay_from_account_id,
        sourceTxnId: plan.source_txn_id,
        rows: buildSchedule({
          principal: total,
          feeTotal: roundCents((Number(plan.fee_total) * total) / principal),
          months: plan.months,
          firstDue: plan.first_due,
        }),
      });
      if (!saved) return { error: "The split is saved, but its credit line bill didn't update. Please try again." };
      await supabase.from("installment_plans").delete().eq("id", plan.id);
    } else if (plan.name !== planName(note)) {
      await supabase.from("installment_plans").update({ name: planName(note) }).eq("id", plan.id);
    }
  }

  refresh();
  return {};
}

/**
 * Splits paid with a credit line before splits made a payment plan: puts
 * each whole bill on the credit line's bill, as one payment. That's the
 * bill after the purchase, or the next one if that date has passed (it's
 * still in what you owe, so it wasn't paid).
 */
export async function addSplitsToBill(splitIds: string[]): Promise<PeopleResult> {
  if (!splitIds.length || splitIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return { error: "Couldn't find that split." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data: records } = await supabase
    .from("transactions")
    .select("id, type, amount, account_id, note, occurred_on, split_id")
    .in("split_id", splitIds);
  if (!records?.length) return { error: "Couldn't find that split." };

  const walletIds = [...new Set(records.map((r) => r.account_id))];
  const wallets = await creditTerms(supabase, walletIds);
  const now = today();
  for (const splitId of splitIds) {
    const bill = records.filter((r) => r.split_id === splitId);
    if (!bill.length || (await splitPlanOf(supabase, bill.map((r) => r.id)))) continue;
    const walletId = bill[0].account_id;
    const wallet = wallets.find((w) => w.id === walletId);
    if (wallet?.type !== "credit_line") return { error: "That split wasn't paid with a credit line." };
    const total = roundCents(bill.reduce((s, r) => s + Number(r.amount), 0));
    const mine = bill.find((r) => r.type === "expense");
    const saved = await savePlan(supabase, {
      kind: "bnpl",
      accountId: walletId,
      name: planName(typedNote(bill.map((r) => ({ note: r.note })))),
      principal: total,
      months: 1,
      payFromAccountId: null,
      sourceTxnId: (mine ?? bill[0]).id,
      rows: buildSchedule({ principal: total, feeTotal: 0, months: 1, firstDue: catchUpDue(bill[0].occurred_on, wallet.dueDay, now, wallet.cutoffDay) }),
    });
    if (!saved) {
      refresh();
      return { error: "Couldn't add it to the bill. Please try again." };
    }
  }

  refresh();
  return {};
}

/** Deletes every record of one split bill: your share and each person's pautang. */
export async function deleteSplit(splitId: string): Promise<PeopleResult> {
  if (!/^[0-9a-f-]{36}$/i.test(splitId)) return { error: "Couldn't find that split." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data, error } = await supabase.from("transactions").delete().eq("split_id", splitId).select("id");
  if (error || !data?.length) return { error: "Couldn't delete that. Please try again." };
  refresh();
  return {};
}

export async function renamePerson(personId: string, name: string, contact: string): Promise<PeopleResult> {
  const clean = cleanName(name);
  if (!clean || clean.length > 60) return { error: "Check the name (up to 60 characters)." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data, error } = await supabase
    .from("accounts")
    .update({ name: clean, contact: cleanName(contact).slice(0, 100) || null })
    .eq("id", personId)
    .eq("type", "person")
    .select("id");
  if (error || !data.length) return FAILED;
  refresh();
  return { personId };
}

// ── Someone else's purchase on your credit line ─────────────────────────
// Tita Flora used your Atome: her purchase is pautang from the credit line,
// and she pays the installments straight to its bill. See
// 0019_cutoff_and_borrowed_lines.sql.

const STEP_19 = "For a credit line or loan someone else pays, run step 19 in supabase/SQL_GUIDE.md first.";

/** False while migration 0019 (installment_plans.person_id) hasn't been run. */
async function hasPlanPeople(supabase: Client): Promise<boolean> {
  const { error } = await supabase.from("installment_plans").select("person_id").limit(1);
  return !error;
}

async function debtAccount(supabase: Client, id: string, type: "credit_line" | "loan") {
  const { data } = await supabase.from("accounts").select("id, name, starting_balance").eq("id", id).eq("type", type).maybeSingle();
  return data;
}

/** Raises what a credit line or loan starts at, so what you owe on it stays the same after `amount` moves out of it. */
async function keepOwed(supabase: Client, line: { id: string; starting_balance: number | string }, amount: number) {
  const { error } = await supabase
    .from("accounts")
    .update({ starting_balance: roundCents(Number(line.starting_balance) + amount) })
    .eq("id", line.id);
  return !error;
}

export type CreditLendInput = {
  who: Who;
  creditLineId: string;
  /** What they bought, like "Phone". */
  note: string;
  /** When they bought it. */
  occurredOn: string;
  /** Each payment, fee included. */
  amount: number;
  /** The fee or interest inside each payment. */
  fee: number;
  /** The whole installment: 1 for a single bill. */
  months: number;
  /** Payments already made before you added it here. */
  alreadyPaid: number;
  /** When the next payment is due. */
  nextDue: string;
  /** It's already in "You owe on it now", so what you owe doesn't go up. */
  alreadyOwed: boolean;
};

/**
 * Someone bought on your credit line and pays it themselves. What's left to
 * pay (the principal of the payments left) becomes pautang from the credit
 * line, and the payments go on its bills as theirs: never in your forecast
 * or Safe to spend. Deleting the pautang in Activity removes the plan too.
 */
export async function lendFromCreditLine(input: CreditLendInput): Promise<PeopleResult> {
  if (!validAmount(input.amount)) return { error: "Enter each payment." };
  if (!(input.fee >= 0) || input.fee >= input.amount) return { error: "The fee has to be less than each payment." };
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36) return { error: "Pick how many months." };
  if (!Number.isInteger(input.alreadyPaid) || input.alreadyPaid < 0 || input.alreadyPaid >= input.months) {
    return { error: "Check how many payments they've already made." };
  }
  if (!isValidDate(input.occurredOn)) return { error: "Pick when they bought it." };
  if (!isValidDate(input.nextDue)) return { error: "Pick when the next payment is due." };
  if (roundCents(input.amount * input.months) > MAX_AMOUNT) return { error: "That amount is too big." };
  if ("name" in input.who && !cleanName(input.who.name)) return { error: "Who is it?" };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await hasPlanPeople(supabase))) return { error: STEP_19 };
  const line = await debtAccount(supabase, input.creditLineId, "credit_line");
  if (!line) return { error: "Pick a credit line." };
  const personId = await personFor(supabase, input.who);
  if (!personId) return { error: "Check the name (up to 60 characters)." };

  const rows = upcomingSchedule(input, input.nextDue);
  const left = roundCents(rows.reduce((sum, r) => sum + r.principalPart, 0));
  const note = cleanNote(input.note);
  const txnId = await record(
    supabase,
    {
      type: "transfer",
      amount: left,
      account_id: line.id,
      to_account_id: personId,
      note: `${note ?? "Purchase"} (on ${line.name})`.slice(0, NOTE_MAX),
      occurred_on: input.occurredOn,
    },
    // Promised by the last payment.
    { personId, kind: "lend", dueOn: rows.at(-1)!.dueOn },
  );
  if (!txnId) return FAILED;

  const saved = await savePlan(supabase, {
    kind: "bnpl",
    accountId: line.id,
    name: planName(note),
    principal: roundCents(rows[0].principalPart * input.months),
    months: input.months,
    payFromAccountId: null,
    sourceTxnId: txnId,
    personId,
    rows,
  });
  if (!saved || (input.alreadyOwed && !(await keepOwed(supabase, line, left)))) {
    // Deleting the pautang takes the plan with it.
    await supabase.from("transactions").delete().eq("id", txnId);
    return FAILED;
  }

  refresh();
  return { personId };
}

/**
 * A plan already on your credit line or loan turns out to be someone
 * else's: they owe you what's left of it and pay it, interest included,
 * from now on. Payments already made stay as they are, and what you owe
 * the lender doesn't change.
 */
export async function assignPlanToPerson(planId: string, who: Who): Promise<PeopleResult> {
  if ("name" in who && !cleanName(who.name)) return { error: "Who is paying it?" };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await hasPlanPeople(supabase))) return { error: STEP_19 };

  const { data: plan } = await supabase
    .from("installment_plans")
    .select("id, kind, account_id, name, source_txn_id, person_id")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { error: "Couldn't find that plan." };
  if (plan.person_id) return { error: "Someone else already pays this one." };
  const loan = plan.kind === "loan";
  const lender = await debtAccount(supabase, plan.account_id, loan ? "loan" : "credit_line");
  if (!lender) return { error: `Couldn't find that ${loan ? "loan" : "credit line"}.` };

  const { data: payments } = await supabase
    .from("scheduled_payments")
    .select("due_on, principal_part, transfer_txn_id, fee_txn_id")
    .eq("plan_id", plan.id);
  const unpaid = (payments ?? []).filter((p) => !p.transfer_txn_id && !p.fee_txn_id);
  const left = roundCents(unpaid.reduce((sum, p) => sum + Number(p.principal_part), 0));
  if (!(left > 0)) return { error: "Nothing's left to pay on it." };
  const lastDue = unpaid.map((p) => p.due_on as string).sort().at(-1)!;

  // BNPL: the purchase you logged. Loan: the money it brought into a wallet.
  const { data: source } = plan.source_txn_id
    ? await supabase.from("transactions").select("*").eq("id", plan.source_txn_id).maybeSingle()
    : { data: null };
  if (!loan && source && (source.split_id || source.type !== "expense")) {
    return { error: "This is a split bill: each person's share is already pautang." };
  }
  if (loan && source && !(source.type === "transfer" && source.account_id === lender.id)) {
    return { error: "Couldn't tell where this loan's money went. Edit the loan first." };
  }

  const personId = await personFor(supabase, who);
  if (!personId) return { error: "Check the name (up to 60 characters)." };
  const note = (loan ? `${plan.name} loan` : `${plan.name} (on ${lender.name})`).slice(0, NOTE_MAX);

  if (source && Number(source.amount) <= left + 0.005) {
    // Nothing paid yet: it was theirs from the start. A purchase stops being your spending, and
    // loan money went to them instead of your wallet. Either way that record becomes the pautang.
    const changed = loan
      ? await supabase.from("transactions").update({ to_account_id: personId, note }).eq("id", source.id)
      : await clearToTransfer(supabase, source.id, personId, note);
    if (changed.error) return FAILED;
    const linked = await supabase
      .from("person_entries")
      .insert({ transaction_id: source.id, person_id: personId, kind: "lend", due_on: lastDue });
    if (linked.error) {
      await supabase
        .from("transactions")
        .update(
          loan
            ? { to_account_id: source.to_account_id, note: source.note }
            : { type: "expense", to_account_id: null, category: source.category, note: source.note },
        )
        .eq("id", source.id);
      return FAILED;
    }
  } else {
    const txnId = await record(
      supabase,
      { type: "transfer", amount: left, account_id: lender.id, to_account_id: personId, note, occurred_on: today() },
      { personId, kind: "lend", dueOn: lastDue },
    );
    if (!txnId) return FAILED;
    // A logged purchase now only counts the part already paid; anything else moves the starting balance instead.
    const kept =
      source && !loan
        ? !(await supabase.from("transactions").update({ amount: roundCents(Number(source.amount) - left) }).eq("id", source.id)).error
        : await keepOwed(supabase, lender, left);
    if (!kept) {
      await supabase.from("transactions").delete().eq("id", txnId);
      return FAILED;
    }
  }

  const { error } = await supabase.from("installment_plans").update({ person_id: personId }).eq("id", plan.id);
  if (error) return { error: "They owe you now, but the plan didn't switch to them. Please try again." };

  refresh();
  return { personId };
}

/** A purchase expense turned into a transfer to someone (subcategory cleared once migration 0015 is run). */
async function clearToTransfer(supabase: Client, id: string, personId: string, note: string) {
  const cleared = { type: "transfer", to_account_id: personId, category: null, note };
  const first = await supabase.from("transactions").update({ ...cleared, subcategory: null }).eq("id", id);
  return isMissingColumn(first.error) ? supabase.from("transactions").update(cleared).eq("id", id) : first;
}

export type PersonLoanInput = {
  who: Who;
  /** The lender, like MariLoan. */
  name: string;
  /** What the loan was for (the full amount for one they were already paying). */
  received: number;
  /** When the money went to them. */
  receivedOn: string;
  monthly: number;
  months: number;
  nextDue: string;
  /** Payments made before you added it here. */
  alreadyPaid: number;
};

/**
 * A loan in your name that someone else took and pays (Tita Flora's
 * MariLoan): its money went to them, so what's still owed on it is pautang,
 * and every payment, interest included, is theirs. Never in your forecast
 * or Safe to spend; They paid sends their money straight to the loan.
 */
export async function addLoanForPerson(input: PersonLoanInput): Promise<PeopleResult & { loanId?: string }> {
  const problem = checkLoan({ ...input, intoAccountId: null });
  if (problem) return { error: problem };
  if (!isValidDate(input.receivedOn)) return { error: "Pick when they got the money." };
  if ("name" in input.who && !cleanName(input.who.name)) return { error: "Who is the loan for?" };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  if (!(await hasPlanPeople(supabase))) return { error: STEP_19 };
  const personId = await personFor(supabase, input.who);
  if (!personId) return { error: "Check the name (up to 60 characters)." };

  const received = roundCents(input.received);
  const rows = loanSchedule({ received, monthly: exactRate(input.monthly), months: input.months }, input.nextDue, input.alreadyPaid);
  const owed = roundCents(rows.reduce((sum, r) => sum + r.principalPart, 0));
  const name = cleanName(input.name);

  const account = await supabase.from("accounts").insert({ name, type: "loan", starting_balance: 0 }).select("id").single();
  if (account.error) return FAILED;
  const loanId = account.data.id;
  const undo = () => supabase.from("accounts").delete().eq("id", loanId);

  // What's still owed went to them: pautang from the loan, promised by the last payment.
  const txnId = await record(
    supabase,
    {
      type: "transfer",
      amount: owed,
      account_id: loanId,
      to_account_id: personId,
      note: `${name} loan`.slice(0, NOTE_MAX),
      occurred_on: input.receivedOn,
    },
    { personId, kind: "lend", dueOn: rows.at(-1)!.dueOn },
  );
  if (!txnId) {
    await undo();
    return FAILED;
  }
  const saved = await savePlan(supabase, {
    kind: "loan",
    accountId: loanId,
    name,
    principal: received,
    months: input.months,
    payFromAccountId: null,
    sourceTxnId: null,
    personId,
    rows,
  });
  if (!saved) {
    await supabase.from("transactions").delete().eq("id", txnId);
    await undo();
    return FAILED;
  }

  refresh();
  return { personId, loanId };
}

/**
 * They paid these installments: their money goes straight to the credit
 * line's bill (a transfer from them to it), so your wallets never move and
 * what they owe you goes down. The fee was theirs too, so it isn't an
 * expense of yours.
 */
export async function theyPaidInstallments(ids: string[], occurredOn = today()): Promise<PeopleResult> {
  if (!ids.length) return {};
  if (!isValidDate(occurredOn)) return { error: "Pick a date." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data: payments } = await supabase
    .from("scheduled_payments")
    .select("id, plan_id, seq, amount, principal_part, transfer_txn_id, fee_txn_id")
    .in("id", ids);
  if (!payments?.length) return { error: "Couldn't find that payment." };
  const { data: plans } = await supabase
    .from("installment_plans")
    .select("id, account_id, name, months, person_id")
    .in("id", [...new Set(payments.map((p) => p.plan_id))]);

  for (const p of payments) {
    if (p.transfer_txn_id || p.fee_txn_id) continue;
    const plan = plans?.find((x) => x.id === p.plan_id);
    if (!plan?.person_id) return { error: "That one's yours to pay: use Pay bill." };
    if (!(Number(p.principal_part) > 0)) continue;
    const label = plan.months > 1 ? `${plan.name} ${p.seq} of ${plan.months}` : plan.name;
    const txnId = await record(
      supabase,
      {
        type: "transfer",
        amount: Number(p.principal_part),
        account_id: plan.person_id,
        to_account_id: plan.account_id,
        note: `${label} · they paid ${formatPeso(Number(p.amount))}`.slice(0, NOTE_MAX),
        occurred_on: occurredOn,
      },
      { personId: plan.person_id, kind: "payment" },
    );
    if (!txnId) return FAILED;
    const { data: updated, error } = await supabase
      .from("scheduled_payments")
      .update({ transfer_txn_id: txnId })
      .eq("id", p.id)
      .is("transfer_txn_id", null)
      .is("fee_txn_id", null)
      .select("id");
    if (error || !updated.length) {
      // Paid in another tab meanwhile: don't count it twice.
      await supabase.from("transactions").delete().eq("id", txnId);
      if (error) return FAILED;
    }
  }

  refresh();
  return {};
}

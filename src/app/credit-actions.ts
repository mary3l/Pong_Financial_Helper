"use server";

import { refresh } from "next/cache";
import { SIGNED_OUT_ERROR, signedInClient } from "@/lib/auth";
import { isValidDate, today } from "@/lib/dates";
import { loanSchedule, upcomingSchedule } from "@/lib/installments";
import { checkLoan, editLoan, exactRate } from "@/lib/loan-edit";
import { MAX_AMOUNT, isSpendable, roundCents, type AccountType } from "@/lib/money";
import { isMissingColumn, pickWallet, savePlan } from "@/lib/server-writes";

// Phase 3: credit lines (SPayLater, Atome), loans (SLoan, MariLoan) and
// paying their installments. See 0005_installments_loans.sql for how each
// peso is counted.

export type CreditResult = { error?: string; id?: string };

const FAILED = { error: "Couldn't save that. Please try again." };

function cleanName(name: unknown) {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

function validAmount(value: number, allowZero = false) {
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= MAX_AMOUNT;
}

export type CreditLineInput = {
  name: string;
  limit: number | null;
  /** Day of the month the bill is due. */
  dueDay: number | null;
  /** Day of the month the statement closes; null when you don't know. */
  cutoffDay: number | null;
  /** What you owe on it right now. */
  used: number;
};

const isDay = (day: number | null) => day === null || (Number.isInteger(day) && day >= 1 && day <= 31);

const CUTOFF_MISSING = "To save a cutoff day, run step 19 in supabase/SQL_GUIDE.md first. Or set it to Not sure.";

/** Saves `row` with the cutoff day; before migration 0019, without it when there's none to save. */
async function withCutoff<T extends { error: { code?: string } | null }>(
  cutoffDay: number | null,
  save: (cutoff: { cutoff_day?: number | null }) => PromiseLike<T>,
): Promise<T | { error: { code: string; message: string } }> {
  const result = await save({ cutoff_day: cutoffDay });
  if (!isMissingColumn(result.error)) return result;
  if (cutoffDay !== null) return { error: { code: "missing", message: CUTOFF_MISSING } };
  return save({});
}

function checkCreditLine(input: CreditLineInput): string | null {
  const name = cleanName(input.name);
  if (!name) return "Give it a name, like SPayLater.";
  if (name.length > 60) return "Keep the name to 60 characters.";
  if (input.limit !== null && !validAmount(input.limit)) return "Check the credit limit, or leave it blank.";
  if (!isDay(input.dueDay)) return "Pick the day the bill is due.";
  if (!isDay(input.cutoffDay)) return "Pick the day the statement cuts off.";
  if (input.cutoffDay !== null && input.dueDay === null) return "Pick the day the bill is due too, so I know when each statement is paid.";
  if (!validAmount(input.used, true)) return "Check how much you owe on it now.";
  return null;
}

/** Adds a BNPL credit line. What you owe now becomes its starting balance. */
export async function addCreditLine(input: CreditLineInput): Promise<CreditResult> {
  const problem = checkCreditLine(input);
  if (problem) return { error: problem };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const saved = await withCutoff(input.cutoffDay, (cutoff) =>
    supabase
      .from("accounts")
      .insert({
        name: cleanName(input.name),
        type: "credit_line",
        credit_limit: input.limit === null ? null : roundCents(input.limit),
        due_day: input.dueDay,
        ...cutoff,
        starting_balance: -roundCents(input.used),
      })
      .select("id")
      .single(),
  );
  if (saved.error?.code === "missing") return { error: CUTOFF_MISSING };
  if (saved.error || !("data" in saved) || !saved.data) return FAILED;

  refresh();
  return { id: saved.data.id };
}

/**
 * Renames a credit line or changes its limit and due day. Setting what you
 * owe adjusts the starting balance, so logged transactions stay as they are.
 */
export async function updateCreditLine(id: string, input: CreditLineInput): Promise<CreditResult> {
  const problem = checkCreditLine(input);
  if (problem) return { error: problem };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const [account, current] = await Promise.all([
    supabase.from("accounts").select("starting_balance").eq("id", id).eq("type", "credit_line").maybeSingle(),
    supabase.from("account_balances").select("balance").eq("account_id", id).maybeSingle(),
  ]);
  if (!account.data || !current.data) return { error: "Couldn't find that credit line." };

  const starting = Number(account.data.starting_balance) + (-input.used - Number(current.data.balance));
  const { error } = await withCutoff(input.cutoffDay, (cutoff) =>
    supabase
      .from("accounts")
      .update({
        name: cleanName(input.name),
        credit_limit: input.limit === null ? null : roundCents(input.limit),
        due_day: input.dueDay,
        ...cutoff,
        starting_balance: roundCents(starting),
      })
      .eq("id", id),
  );
  if (error?.code === "missing") return { error: CUTOFF_MISSING };
  if (error) return FAILED;

  refresh();
  return {};
}

export type UpcomingInput = {
  /** What it's for, like "Shopee order". */
  name: string;
  /** Each payment, interest or fee included. */
  amount: number;
  /** The interest or fee inside each payment; 0 for none. */
  fee: number;
  /** When the next payment is due. */
  firstDue: string;
  /** The whole installment: 1 for a single bill. */
  months: number;
  /** Payments of the installment made before you added it here. */
  alreadyPaid: number;
  /** True when it isn't in "You owe on it now" yet: what you owe goes up by what's left to pay. */
  addToOwed: boolean;
};

/**
 * Payments you expect on SPayLater, Atome or a bank's credit line: a bill
 * the provider's app already shows, or an installment that's already
 * running ("4 of 6"). Saved as a plan with no purchase behind it, so
 * they're in Coming up, the forecast and Safe to spend, and Pay bill moves
 * money to the credit line as usual. The interest or fee part is an expense.
 */
export async function addUpcomingPayments(accountId: string, input: UpcomingInput): Promise<CreditResult> {
  const name = cleanName(input.name) || "Upcoming bill";
  if (name.length > 60) return { error: "Keep the name to 60 characters." };
  if (!validAmount(input.amount)) return { error: "Enter how much you'll pay." };
  if (!validAmount(input.fee, true) || input.fee >= input.amount) {
    return { error: "The interest or fee has to be less than the payment." };
  }
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36) return { error: "Pick how many months." };
  if (!Number.isInteger(input.alreadyPaid) || input.alreadyPaid < 0 || input.alreadyPaid >= input.months) {
    return { error: "Check how many payments you've already made." };
  }
  if (!isValidDate(input.firstDue)) return { error: "Pick when it's due." };
  if (roundCents(input.amount * input.months) > MAX_AMOUNT) return { error: "That amount is too big." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };
  const { data: account } = await supabase
    .from("accounts")
    .select("id, starting_balance")
    .eq("id", accountId)
    .eq("type", "credit_line")
    .maybeSingle();
  if (!account) return { error: "Couldn't find that credit line." };

  const rows = upcomingSchedule(input, input.firstDue);
  // What's still owed on it: the principal of the payments left. Interest is counted as you pay.
  const owedLeft = roundCents(rows.reduce((sum, r) => sum + r.principalPart, 0));
  const saved = await savePlan(supabase, {
    kind: "bnpl",
    accountId,
    name,
    principal: roundCents(rows[0].principalPart * input.months),
    months: input.months,
    payFromAccountId: null,
    sourceTxnId: null,
    rows,
  });
  if (!saved) return FAILED;

  if (input.addToOwed) {
    const { error } = await supabase
      .from("accounts")
      .update({ starting_balance: roundCents(Number(account.starting_balance) - owedLeft) })
      .eq("id", accountId);
    if (error) {
      await supabase.from("installment_plans").delete().eq("id", saved);
      return FAILED;
    }
  }

  refresh();
  return {};
}

export type LoanInput = {
  name: string;
  received: number;
  /** The wallet it landed in; null if you got it before you started using the app. */
  intoAccountId: string | null;
  receivedOn: string;
  monthly: number;
  months: number;
  /** The next amortization date. */
  nextDue: string;
  payFromAccountId: string | null;
  /** Payments made before you added it here. */
  alreadyPaid: number;
};

/**
 * Adds a loan: a loan account, the money received as a transfer from it
 * (never income), and its amortization schedule.
 */
export async function addLoan(input: LoanInput): Promise<CreditResult> {
  const problem = checkLoan(input);
  if (problem) return { error: problem };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const received = roundCents(input.received);
  const rows = loanSchedule({ received, monthly: exactRate(input.monthly), months: input.months }, input.nextDue, input.alreadyPaid);
  const owed = roundCents(rows.reduce((sum, r) => sum + r.principalPart, 0));
  const name = cleanName(input.name);

  // Received before using the app: the loan starts at what's still owed.
  const account = await supabase
    .from("accounts")
    .insert({ name, type: "loan", starting_balance: input.intoAccountId ? 0 : -owed })
    .select("id")
    .single();
  if (account.error) return FAILED;
  const loanId = account.data.id;

  let sourceTxnId: string | null = null;
  if (input.intoAccountId) {
    const { data, error } = await supabase
      .from("transactions")
      .insert({
        type: "transfer",
        amount: received,
        account_id: loanId,
        to_account_id: input.intoAccountId,
        note: `${name} received`,
        occurred_on: input.receivedOn,
      })
      .select("id")
      .single();
    if (error) {
      await supabase.from("accounts").delete().eq("id", loanId);
      return FAILED;
    }
    sourceTxnId = data.id;
  }

  const saved = await savePlan(supabase, {
    kind: "loan",
    accountId: loanId,
    name,
    principal: received,
    months: input.months,
    payFromAccountId: input.payFromAccountId,
    sourceTxnId,
    rows,
  });
  if (!saved) {
    if (sourceTxnId) await supabase.from("transactions").delete().eq("id", sourceTxnId);
    await supabase.from("accounts").delete().eq("id", loanId);
    return FAILED;
  }

  refresh();
  return { id: loanId };
}

export type LoanUpdate = {
  name: string;
  received: number;
  monthly: number;
  months: number;
  /** When the first unpaid payment is due. */
  nextDue: string;
  payFromAccountId: string | null;
  /** Payments made before adding it here. Only for a loan you were already paying. */
  paidBefore?: number;
  /**
   * Added as just received, but the money was already in the wallet (or
   * spent) before: takes the transfer back out, so it isn't counted twice.
   */
  alreadyHad?: boolean;
};

/**
 * Edits a saved loan. Payments already made stay; the unpaid ones are
 * worked out again (see lib/loan-edit). A new amount received changes the
 * transfer that brought it in, or for a loan you were already paying, what
 * it started at.
 */
export async function updateLoan(accountId: string, input: LoanUpdate): Promise<CreditResult> {
  const name = cleanName(input.name);
  if (!name) return { error: "Give the loan a name, like SLoan." };
  if (name.length > 60) return { error: "Keep the name to 60 characters." };
  if (!validAmount(input.received)) return { error: "Enter the loan amount." };
  if (!validAmount(input.monthly)) return { error: "Enter the monthly payment." };
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 60) return { error: "Pick how many months." };
  if (!isValidDate(input.nextDue)) return { error: "Pick when the next payment is due." };

  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data: account } = await supabase.from("accounts").select("id, type").eq("id", accountId).maybeSingle();
  if (!account || account.type !== "loan") return { error: "Couldn't find that loan." };
  if (input.payFromAccountId) {
    const { data: from } = await supabase.from("accounts").select("type").eq("id", input.payFromAccountId).maybeSingle();
    if (!from || !isSpendable(from.type as AccountType)) return { error: "Pay from cash, a bank or an e-wallet." };
  }

  const { data: plan } = await supabase
    .from("installment_plans")
    // "*": person_id only exists after migration 0019.
    .select("*")
    .eq("account_id", accountId)
    .eq("kind", "loan")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  // Its plan was removed, or someone else pays it (what they owe follows its terms): only the name changes.
  if (!plan || plan.person_id) {
    const { error } = await supabase.from("accounts").update({ name }).eq("id", accountId);
    if (error) return FAILED;
    refresh();
    return {};
  }

  const { data: payments, error: readError } = await supabase
    .from("scheduled_payments")
    .select("id, seq, due_on, amount, principal_part, fee_part, transfer_txn_id, fee_txn_id")
    .eq("plan_id", plan.id);
  if (readError) return FAILED;
  // From here on it's a loan you were already paying: no transfer in.
  const hadIt = Boolean(plan.source_txn_id && input.alreadyHad);
  const sourceTxnId = hadIt ? null : plan.source_txn_id;
  if (sourceTxnId && input.paidBefore) {
    return { error: "This loan's money came in here, so there are no payments from before." };
  }
  const isPaid = (p: (typeof payments)[number]) => Boolean(p.transfer_txn_id || p.fee_txn_id);
  const edited = editLoan(
    payments.map((p) => ({
      seq: p.seq,
      principalPart: Number(p.principal_part),
      feePart: Number(p.fee_part),
      paid: isPaid(p),
    })),
    {
      received: roundCents(input.received),
      monthly: exactRate(input.monthly),
      months: input.months,
      nextDue: input.nextDue,
      paidBefore: sourceTxnId ? undefined : input.paidBefore,
    },
  );
  if ("error" in edited) return edited;

  // Swap the unpaid payments for the new ones, putting the old back if that fails.
  const unpaid = payments.filter((p) => !isPaid(p));
  if (unpaid.length) {
    const { error } = await supabase.from("scheduled_payments").delete().in("id", unpaid.map((p) => p.id));
    if (error) return FAILED;
  }
  const restore = async () => {
    if (unpaid.length) {
      await supabase.from("scheduled_payments").insert(
        unpaid.map((p) => ({
          plan_id: plan.id,
          seq: p.seq,
          due_on: p.due_on,
          amount: p.amount,
          principal_part: p.principal_part,
          fee_part: p.fee_part,
        })),
      );
    }
  };
  if (edited.rows.length) {
    const { error } = await supabase.from("scheduled_payments").insert(
      edited.rows.map((r) => ({
        plan_id: plan.id,
        seq: r.seq,
        due_on: r.dueOn,
        amount: r.amount,
        principal_part: r.principalPart,
        fee_part: r.feePart,
      })),
    );
    if (error) {
      await restore();
      return FAILED;
    }
  }

  const dues = [...payments.filter(isPaid).map((p) => p.due_on), ...edited.rows.map((r) => r.dueOn)].sort();
  const [planUpdate, accountUpdate, sourceUpdate] = await Promise.all([
    supabase
      .from("installment_plans")
      .update({
        name,
        principal: roundCents(input.received),
        fee_total: edited.feeTotal,
        months: input.months,
        first_due: dues[0] ?? input.nextDue,
        pay_from_account_id: input.payFromAccountId,
        // Unlinked before the transfer goes: deleting a plan's source deletes the plan.
        ...(hadIt ? { source_txn_id: null } : {}),
      })
      .eq("id", plan.id),
    // Already paying when added: no transfer in, so the loan starts at what was owed.
    supabase
      .from("accounts")
      .update(sourceTxnId || hadIt ? { name } : { name, starting_balance: -edited.owedAtStart })
      .eq("id", accountId),
    sourceTxnId
      ? supabase.from("transactions").update({ amount: roundCents(input.received) }).eq("id", sourceTxnId)
      : Promise.resolve({ error: null }),
  ]);
  if (planUpdate.error || accountUpdate.error || sourceUpdate.error) return FAILED;

  if (hadIt && plan.source_txn_id) {
    // Take the money back out of the wallet, then start the loan at what was owed.
    const removed = await supabase.from("transactions").delete().eq("id", plan.source_txn_id);
    if (removed.error) {
      await supabase.from("installment_plans").update({ source_txn_id: plan.source_txn_id }).eq("id", plan.id);
      return FAILED;
    }
    const started = await supabase.from("accounts").update({ starting_balance: -edited.owedAtStart }).eq("id", accountId);
    if (started.error) return FAILED;
  }

  refresh();
  return {};
}

/**
 * Pays installments today: the principal part as a transfer to the credit
 * line or loan, the fee part as an expense. `fromAccountId` overrides the
 * plan's usual wallet.
 */
export async function payInstallments(ids: string[], fromAccountId?: string): Promise<CreditResult> {
  if (!ids.length) return {};
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data: payments } = await supabase
    .from("scheduled_payments")
    .select("id, plan_id, seq, principal_part, fee_part, transfer_txn_id, fee_txn_id")
    .in("id", ids);
  if (!payments?.length) return { error: "Couldn't find that payment." };
  const { data: plans } = await supabase
    .from("installment_plans")
    .select("id, account_id, name, months, pay_from_account_id")
    .in("id", [...new Set(payments.map((p) => p.plan_id))]);

  if (fromAccountId) {
    const { data: from } = await supabase.from("accounts").select("type").eq("id", fromAccountId).maybeSingle();
    if (!from || !isSpendable(from.type as AccountType)) return { error: "Pay from cash, a bank or an e-wallet." };
  }

  for (const p of payments) {
    if (p.transfer_txn_id || p.fee_txn_id) continue;
    const plan = plans?.find((x) => x.id === p.plan_id);
    if (!plan) return FAILED;
    const wallet = fromAccountId ?? (await pickWallet(supabase, plan.pay_from_account_id));
    if (!wallet) return { error: "Add a wallet first, so I know where the money comes from." };

    const note = plan.months > 1 ? `${plan.name} ${p.seq} of ${plan.months}` : plan.name;
    const created: string[] = [];
    let transferId: string | null = null;
    let feeId: string | null = null;
    if (Number(p.principal_part) > 0) {
      const { data, error } = await supabase
        .from("transactions")
        .insert({
          type: "transfer",
          amount: Number(p.principal_part),
          account_id: wallet,
          to_account_id: plan.account_id,
          note,
          occurred_on: today(),
        })
        .select("id")
        .single();
      if (error) return FAILED;
      transferId = data.id;
      created.push(data.id);
    }
    if (Number(p.fee_part) > 0) {
      const { data, error } = await supabase
        .from("transactions")
        .insert({
          type: "expense",
          amount: Number(p.fee_part),
          account_id: wallet,
          category: "fees",
          note: `${note} · fee`,
          occurred_on: today(),
        })
        .select("id")
        .single();
      if (error) {
        await supabase.from("transactions").delete().in("id", created);
        return FAILED;
      }
      feeId = data.id;
      created.push(data.id);
    }

    const { data: updated, error } = await supabase
      .from("scheduled_payments")
      .update({ transfer_txn_id: transferId, fee_txn_id: feeId })
      .eq("id", p.id)
      .is("transfer_txn_id", null)
      .is("fee_txn_id", null)
      .select("id");
    if (error || !updated.length) {
      // Paid in another tab meanwhile: don't count it twice.
      await supabase.from("transactions").delete().in("id", created);
      if (error) return FAILED;
    }
  }

  refresh();
  return {};
}

/** Undo a payment: deletes its transfer and fee, which un-pays it. */
export async function undoInstallment(id: string): Promise<CreditResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data } = await supabase
    .from("scheduled_payments")
    .select("transfer_txn_id, fee_txn_id")
    .eq("id", id)
    .maybeSingle();
  const txns = [data?.transfer_txn_id, data?.fee_txn_id].filter((t): t is string => Boolean(t));
  if (!txns.length) {
    refresh();
    return {};
  }
  const { error } = await supabase.from("transactions").delete().in("id", txns);
  if (error) return { error: "Couldn't undo that. Please try again." };

  refresh();
  return {};
}

/**
 * Removes a plan and its unpaid schedule, e.g. one entered by mistake or
 * paid off early. Payments already made stay in Activity.
 */
export async function removePlan(id: string): Promise<CreditResult> {
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data, error } = await supabase.from("installment_plans").delete().eq("id", id).select("id");
  if (error || !data.length) return { error: "Couldn't remove that plan. Please try again." };

  refresh();
  return {};
}

/**
 * Deletes a loan for good, as if it was never added: the money it brought
 * into a wallet, every payment and its interest, the plan and the loan.
 * For a duplicate or a mistake. Wallets go back to what they'd be without it.
 */
export async function deleteLoanForGood(accountId: string): Promise<CreditResult> {
  // It goes into a filter string below, so only a plain id.
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return { error: "Couldn't find that loan." };
  const supabase = await signedInClient();
  if (!supabase) return { error: SIGNED_OUT_ERROR };

  const { data: account } = await supabase.from("accounts").select("id, type").eq("id", accountId).maybeSingle();
  if (!account || account.type !== "loan") return { error: "Couldn't find that loan." };

  // The interest of each payment is an expense from the wallet, not linked to the loan account: find it via the schedule.
  const { data: plans, error: plansError } = await supabase.from("installment_plans").select("id").eq("account_id", accountId);
  if (plansError) return FAILED;
  const planIds = plans.map((p) => p.id);
  let feeIds: string[] = [];
  // Payments whose fee the schedule already knows.
  const scheduled = new Set<string>();
  if (planIds.length) {
    const { data: payments, error } = await supabase
      .from("scheduled_payments")
      .select("transfer_txn_id, fee_txn_id")
      .in("plan_id", planIds);
    if (error) return FAILED;
    feeIds = payments.map((p) => p.fee_txn_id).filter((id): id is string => Boolean(id));
    for (const p of payments) if (p.transfer_txn_id) scheduled.add(p.transfer_txn_id);
  }

  // A plan removed earlier took its schedule with it: find those fees by their payment instead.
  // Each is an expense noted "<payment note> · fee", from the same wallet on the same day.
  const { data: allPaymentsIn, error: paymentsError } = await supabase
    .from("transactions")
    .select("id, account_id, note, occurred_on")
    .eq("to_account_id", accountId)
    .not("note", "is", null);
  if (paymentsError) return FAILED;
  const paymentsIn = allPaymentsIn.filter((p) => !scheduled.has(p.id));
  if (paymentsIn.length) {
    const { data: fees, error } = await supabase
      .from("transactions")
      .select("id, account_id, note, occurred_on")
      .eq("type", "expense")
      .eq("category", "fees")
      .in("note", [...new Set(paymentsIn.map((p) => `${p.note} · fee`))]);
    if (error) return FAILED;
    const taken = new Set(feeIds);
    for (const p of paymentsIn) {
      const fee = fees.find(
        (f) => !taken.has(f.id) && f.note === `${p.note} · fee` && f.account_id === p.account_id && f.occurred_on === p.occurred_on,
      );
      if (fee) taken.add(fee.id);
    }
    feeIds = [...taken];
  }

  // Plans first (their payments go with them), so nothing still points at the transactions.
  if (planIds.length) {
    const { error } = await supabase.from("installment_plans").delete().in("id", planIds);
    if (error) return FAILED;
  }
  if (feeIds.length) {
    const { error } = await supabase.from("transactions").delete().in("id", feeIds);
    if (error) return FAILED;
  }
  // The money received and every payment: transfers from or to the loan.
  const transfers = await supabase.from("transactions").delete().or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`);
  if (transfers.error) return FAILED;

  // Anything else saved against it stops pointing at it.
  const [planned, recurring] = await Promise.all([
    supabase.from("planned_expenses").update({ account_id: null }).eq("account_id", accountId),
    supabase.from("recurring_items").update({ account_id: null }).eq("account_id", accountId),
  ]);
  if (planned.error || recurring.error) return FAILED;

  const { error } = await supabase.from("accounts").delete().eq("id", accountId);
  if (error) return { error: "Its history is gone, but the loan itself couldn't be deleted. Please try again." };

  refresh();
  return {};
}

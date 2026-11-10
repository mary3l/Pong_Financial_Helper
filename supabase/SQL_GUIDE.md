# Database setup, step by step

Every phase of the app adds tables or columns. Each one is a file in
`supabase/migrations/`. Run them **once each, in order**, in the Supabase SQL Editor.
Pick up from the first step you haven't run yet.

## How to run one file

1. Open your project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In the left sidebar click **SQL Editor**, then **+ New query** (or the **+** tab).
3. Open the migration file from this folder in your editor, select everything
   (`Ctrl+A`), copy it, and paste it into the query box.
4. Click **Run** (or press `Ctrl+Enter`).
5. You should see **Success. No rows returned**.
6. Paste the **Check** query for that step into a new query and run it. It should
   return what the step says.

If Supabase asks *"This query has destructive operations, run anyway?"*, that's the
`drop constraint` lines that swap a rule for a wider one. No data is deleted; click
**Run this query**.

### If something goes wrong

| Error | What it means | What to do |
| --- | --- | --- |
| `relation "..." already exists` / `column "..." already exists` | That file was already run. | Skip to the next step. |
| `relation "public.xyz" does not exist` | An earlier file wasn't run. | Run the earlier steps first, in order. |
| `constraint "..." does not exist` | The file ran halfway before. | Tell Claude which step and the full error. |
| App shows `Supabase PGRST205` | A table the screen needs is missing. | Run the step that creates it. |

After the last step, reload the app. If a screen still says a table is missing, wait a
few seconds (Supabase refreshes its API cache) and reload again.

---

## Step 1 · Phase 0: wallets and transactions

File: `migrations/0001_accounts_transactions.sql`

Adds `accounts` (your wallets), `transactions` and the `account_balances` view.

**Check**

```sql
select count(*) from information_schema.tables
where table_schema = 'public' and table_name in ('accounts', 'transactions', 'account_balances');
```

Expect `3`.

## Step 2 · Phase 1: payday and bills

File: `migrations/0002_recurring_items.sql`

Adds `recurring_items` (your payday schedule and monthly bills).

**Check**

```sql
select to_regclass('public.recurring_items') is not null as ok;
```

Expect `true`.

## Step 3 · Phase 2: planning

File: `migrations/0003_planning.sql`

Adds `bill_payments` (Mark paid), `planned_expenses` and `budgets`.

**Check**

```sql
select count(*) from information_schema.tables
where table_schema = 'public' and table_name in ('bill_payments', 'planned_expenses', 'budgets');
```

Expect `3`.

## Step 4 · Recurring and planned income & expenses

File: `migrations/0004_scheduled_cashflows.sql`

Powers **Plan › Scheduled**: payroll, allowance, rent, tuition, once or on repeat, with
**Add income** / **Mark paid** to log them in one tap.

- `recurring_items` can now be `income` too, and gets `category` and `ends_on`.
- `planned_expenses` gets `type` (`expense` or `income`), so one-off income like a 13th
  month pay can be planned too.

Supabase will warn about a destructive operation (it swaps the rule for which kinds are
allowed). Click **Run this query**. Nothing is deleted.

**Check**

```sql
select
  (select count(*) from information_schema.columns
   where table_name = 'recurring_items' and column_name in ('category', 'ends_on')) as recurring_columns,
  (select count(*) from information_schema.columns
   where table_name = 'planned_expenses' and column_name = 'type') as planned_columns;
```

Expect `recurring_columns = 2` and `planned_columns = 1`.

## Step 5 · Phase 3: BNPL, loans and digital banks

File: `migrations/0005_installments_loans.sql`

Powers SPayLater / Atome payment plans in Add, **Money › + BNPL**, **Money › + Loan**,
the credit line and loan screens, and installments in Coming up and the forecast.

- `installment_plans`: one row per BNPL purchase or loan.
- `scheduled_payments`: one row per installment, linked to the transfer (and fee
  expense) once you pay it.

MariBank, GoTyme, GCash and Maya need nothing new: add them as normal wallets.

**Check**

```sql
select count(*) from information_schema.tables
where table_schema = 'public' and table_name in ('installment_plans', 'scheduled_payments');
```

Expect `2`.

## Step 6 · Phase 4: utang, pautang and split bills

File: `migrations/0006_people.sql`

Powers **Money › Utang & pautang**, Lend / borrow, the person screen (Record payment,
Send reminder, Forgive), the **Split this bill** toggle in Add, and the overdue nudge
on Home.

- `accounts` can now be of type `person`: each person's balance is what they owe you
  (above 0) or what you owe them (below 0). Adds an optional `contact` column.
- `person_entries`: due date, kind (lend, borrow, split, payment, forgive) and the
  "count it in my forecast" switch for each utang / pautang transaction.

Supabase will warn about a destructive operation (it swaps the rule for which account
types are allowed). Click **Run this query**. Nothing is deleted.

**Check**

```sql
select
  to_regclass('public.person_entries') is not null as entries_table,
  exists (select 1 from information_schema.columns
          where table_name = 'accounts' and column_name = 'contact') as contact_column;
```

Expect `true` and `true`.

## Step 7 · Phase 5: Grocery mode

File: `migrations/0007_grocery.sql`

Powers **Grocery mode** checkout and price memory.

- `products` and `product_prices`: each barcode you've scanned, and what it cost at
  each store, so next time it fills in by itself.
- `grocery_trips` and `grocery_items`: a finished trip and its items, attached to the one
  Groceries expense it saves. Deleting that expense in Activity deletes the trip too.

The trip you're on is kept on your phone until checkout, so nothing is saved here while
you shop.

**Check**

```sql
select count(*) from information_schema.tables
where table_schema = 'public'
  and table_name in ('products', 'product_prices', 'grocery_trips', 'grocery_items');
```

Expect `4`.

## Step 8 · Phase 6: security hardening

File: `migrations/0008_hardening.sql`

No new screens. It tightens per-user data security:

- Signed-out visitors (Supabase's `anon` role) lose all access to the app's tables and
  the balances view. Row-level security already hid everything from them; now the
  grants are gone too, including for tables you add later.
- The balances view is re-confirmed to run with your own rights, so RLS applies.
- Notes and categories have length limits, a credit limit only fits a credit line, and
  only lending, borrowing and splits can carry a due date. These apply to new and edited
  rows; rows you already have are left as they are.

**Check**

```sql
-- Tables in public without row-level security. Expect no rows.
select c.relname as table_without_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Anything signed-out visitors can still touch. Expect no rows.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
```

Run them one at a time: both should say **Success. No rows returned**.

## Step 9 · Home screen widget

File: `migrations/0009_widget.sql`

Adds `widget_keys` and the `widget_spent_today` function for the iPhone widget
(Settings › Home screen widget). Only a hash of each widget key is stored, and the key can
read one thing: what you spent today.

**Check**

```sql
select to_regclass('public.widget_keys') is not null
   and to_regprocedure('public.widget_spent_today(text)') is not null as ok;
```

Expect `true`.

## Step 10 · Wallet categories and daily interest

File: `migrations/0010_wallet_categories_interest.sql`

Powers the **Category** (Spending, Savings, Emergency fund, Investments) and **Interest rate**
fields when you edit a wallet in Money, and **+ Add interest** for MariBank and GoTyme.

- `accounts.purpose`: what the wallet's money is for. Every wallet you have starts as
  Spending, so Safe to spend doesn't change until you pick another category.
- `accounts.interest_rate` and `interest_since`: the yearly rate and the day it was set.

Until you run this, the app still works and treats every wallet as Spending; saving a
category or rate asks you to run this step.

**Check**

```sql
select count(*) from information_schema.columns
where table_name = 'accounts' and column_name in ('purpose', 'interest_rate', 'interest_since');
```

Expect `3`.

## Step 11 · GoTyme monthly interest

File: `migrations/0011_interest_payout.sql`

Lets a wallet say **when** the bank credits its interest. MariBank adds it every day;
GoTyme Go Save works it out daily but adds the month's interest on the 1st, after the
20% tax.

- `accounts.interest_payout`: `daily` or `monthly`. Every wallet you have starts as
  `daily`, so nothing changes until you set a wallet to monthly.

Until you run this, the app still works and treats every wallet's interest as daily;
setting a wallet to monthly asks you to run this step.

**Check**

```sql
select count(*) from information_schema.columns
where table_name = 'accounts' and column_name = 'interest_payout';
```

Expect `1`.

## Step 12 · Split bills as one row in Activity

File: `migrations/0012_split_groups.sql`

Ties together every record a split bill makes (your share and each person's pautang),
so Activity shows the bill as **one row** and tapping it opens the breakdown.

- `transactions.split_id`: the same id on every record of one split.
- Splits you already saved are linked too (their transfers and "my share" expense,
  matched by wallet, day and bill total).

Until you run this, the app still works and shows each record of a split on its own
row.

**Check**

```sql
select count(*) from information_schema.columns
where table_name = 'transactions' and column_name = 'split_id';
```

Expect `1`.

## Step 13 · Payroll calculator

File: `migrations/0013_payroll.sql`

Lets Plan › Scheduled › **Payroll calculator** work out each payday from your daily
rate, the days you worked, late minutes and overtime, and keep your SSS, PhilHealth,
Pag-IBIG and 8% income tax in Money going out.

- `payroll_settings`: your daily rate, hours per day, start time, overtime rate and
  which contributions you pay.
- `payroll_days`: each day of a saved cutoff (worked, leave with its reason, or off,
  and your time in).
- `payroll_overtime`: overtime entries, by time.
- `recurring_items.payroll_key` and `planned_expenses.payroll_key`: mark the bills the
  calculator manages.

Until you run this, the app still works; the Payroll calculator screen asks you to run
this step.

**Check**

```sql
select count(*) from information_schema.tables
where table_schema = 'public' and table_name in ('payroll_settings', 'payroll_days', 'payroll_overtime');
```

Expect `3`.

## Step 14 · Time on transactions

File: `migrations/0014_transaction_time.sql`

Lets Add and Edit save the **time** something happened, next to its date, and
Activity shows it ("Nov 5, 3:42 PM").

- `transactions.occurred_time`: the time you picked, in Philippine time. Empty for
  older records; those show the time they were logged.

Until you run this, the app still works: it saves without the time you picked and
shows when each record was logged.

**Check**

```sql
select count(*) from information_schema.columns
where table_name = 'transactions' and column_name = 'occurred_time';
```

Expect `1`.

## Step 15 · Subcategories

File: `migrations/0015_subcategories.sql`

Lets you type your own **subcategory** under a category in Add and Edit, like
Transpo › Jeep or Food › Merienda. The ones you've used before show up as chips next
time, most used first.

- `transactions.subcategory`: what you typed, up to 40 characters. Empty for older
  records and transfers.

Until you run this, the app still works without subcategories; saving one asks you to
run this step.

**Check**

```sql
select count(*) from information_schema.columns
where table_name = 'transactions' and column_name = 'subcategory';
```

Expect `1`.

## Step 16 · Savings goals (GoTyme GoalSave)

File: `migrations/0016_wallet_goals.sql`

Gives a Savings, Emergency fund or Investments wallet a **goal**: how much you're saving
for and, if you like, by when. It works like a GoTyme GoalSave, so add each GoalSave as
its own wallet. With a date, Money shows what to put in every day, week or month to get
there, counting the wallet's interest (GoTyme works it out daily and adds it on the 1st,
after the 20% tax).

- `accounts.goal_amount`: the target in pesos. Empty means no goal.
- `accounts.goal_date`: the deadline. Optional, and only with a goal amount.

Until you run this, wallets work as before; saving a goal asks you to run this step.

**Check**

```sql
select count(*) from information_schema.columns
where table_name = 'accounts' and column_name in ('goal_amount', 'goal_date');
```

Expect `2`.

## Step 17 · Dollar wallets and time deposits (GoTyme USD Time Deposit)

File: `migrations/0017_usd_time_deposits.sql`

Lets a wallet hold **US dollars**, and lets a wallet be a **time deposit** that pays its
interest when it matures. Name a wallet "GoTyme USD" and Money offers to set it up.

- `accounts.currency`: `PHP` (every wallet you have now) or `USD`. A wallet's balance and
  its transactions are in its own currency. It's picked when you add the wallet.
- `accounts.fx_rate`: pesos per US$1, which you set. Dollars count in You have and Net
  worth at this rate. They're never spending money, so never in Safe to spend.
- `accounts.matures_on`: when a time deposit matures. Interest builds up daily and is
  added that day, after a 15% tax on dollars (20% on pesos).
- `accounts.interest_payout` can now also be `maturity`.
- `transactions.to_amount`: on a transfer between a peso and a dollar wallet, what
  landed (₱5,850 out, $100 in).
- A check on every transaction makes sure a transfer between pesos and dollars says
  what landed, and that nothing is bought with dollars (they only move by transfer).
- `account_balances` is replaced so a transfer adds what landed.

Until you run this, every wallet is in pesos; adding a dollar wallet or a time deposit
asks you to run this step.

**Check**

```sql
select count(*) from information_schema.columns
where (table_name = 'accounts' and column_name in ('currency', 'fx_rate', 'matures_on'))
   or (table_name = 'transactions' and column_name = 'to_amount');
```

Expect `4`.

## Step 18 · Your own contribution amounts

File: `migrations/0018_contribution_amounts.sql`

Lets the Payroll calculator use the SSS, PhilHealth and Pag-IBIG amounts your company
actually takes (say, while you're not yet regular) instead of the standard rates.

- `payroll_settings.sss_amount`, `philhealth_amount`, `pagibig_amount`: what you
  entered. Empty means calculated.

Until you run this, the calculator uses the standard rates; saving your own amounts
asks you to run this step.

**Check**

```sql
select count(*) from information_schema.columns
where table_name = 'payroll_settings' and column_name in ('sss_amount', 'philhealth_amount', 'pagibig_amount');
```

Expect `3`.

## Step 19 · Statement cutoff, and someone else using your credit line

File: `migrations/0019_cutoff_and_borrowed_lines.sql`

Powers **Statement cuts off** when you add or edit a credit line, and lending from a
credit line (Tita Flora used your Atome and pays it herself).

- `accounts.cutoff_day`: the day the credit line's statement closes. A purchase on or
  before it goes on the next bill; one after it waits a month. Empty: Pong guesses, as
  before.
- `installment_plans.person_id`: the person who pays a plan on your credit line. Their
  installments stay on the credit line's bills, but never count in your forecast, Safe
  to spend or BNPL cap, and **They paid** sends their payment straight to the bill.

Until you run this, credit lines work as before; saving a cutoff day or lending from a
credit line asks you to run this step.

**Check**

```sql
select count(*) from information_schema.columns
where (table_name = 'accounts' and column_name = 'cutoff_day')
   or (table_name = 'installment_plans' and column_name = 'person_id');
```

Expect `2`.

---

## Step 20 · Safe to spend on the home screen widget

File: `migrations/0020_widget_safe_to_spend.sql`

Makes the iPhone widget show what's left of today's Safe to spend instead of Spent today.

- `widget_keys.sts_on`, `sts_per_day`, `sts_next_payday`: each time Home works out Safe to
  spend, it saves the day's amount here (only if you made a widget key).
- `widget_safe_to_spend(widget_key)`: the widget takes today's spending off that amount, with
  the same rule as Home (Spending wallets only; bills and installments you marked paid don't
  count).

Until you run this, the widget keeps showing Spent today. After running it, open Home once so
it saves today's amount, and copy the widget script again from Settings › Home screen widget.

**Check**

```sql
select to_regprocedure('public.widget_safe_to_spend(text)') is not null;
```

Expect `true`.

---

## All done?

This one query shows which steps have been run. Every column should be `true`.

```sql
select
  to_regclass('public.accounts') is not null                as step_1,
  to_regclass('public.recurring_items') is not null         as step_2,
  to_regclass('public.budgets') is not null                 as step_3,
  exists (select 1 from information_schema.columns
          where table_name = 'planned_expenses' and column_name = 'type') as step_4,
  to_regclass('public.scheduled_payments') is not null      as step_5,
  to_regclass('public.person_entries') is not null          as step_6,
  to_regclass('public.grocery_items') is not null           as step_7,
  exists (select 1 from pg_constraint
          where conname = 'accounts_credit_limit_type_check') as step_8,
  to_regclass('public.widget_keys') is not null             as step_9,
  exists (select 1 from information_schema.columns
          where table_name = 'accounts' and column_name = 'purpose') as step_10,
  exists (select 1 from information_schema.columns
          where table_name = 'accounts' and column_name = 'interest_payout') as step_11,
  exists (select 1 from information_schema.columns
          where table_name = 'transactions' and column_name = 'split_id') as step_12,
  to_regclass('public.payroll_settings') is not null        as step_13,
  exists (select 1 from information_schema.columns
          where table_name = 'transactions' and column_name = 'occurred_time') as step_14,
  exists (select 1 from information_schema.columns
          where table_name = 'transactions' and column_name = 'subcategory') as step_15,
  exists (select 1 from information_schema.columns
          where table_name = 'accounts' and column_name = 'goal_amount') as step_16,
  exists (select 1 from information_schema.columns
          where table_name = 'transactions' and column_name = 'to_amount') as step_17,
  exists (select 1 from information_schema.columns
          where table_name = 'payroll_settings' and column_name = 'sss_amount') as step_18,
  exists (select 1 from information_schema.columns
          where table_name = 'installment_plans' and column_name = 'person_id') as step_19,
  to_regprocedure('public.widget_safe_to_spend(text)') is not null as step_20;
```

The first `false` is the step to run next.

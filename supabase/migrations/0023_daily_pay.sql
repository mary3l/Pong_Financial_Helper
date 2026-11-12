-- Pay every work day, a rate per month, weekends, and cutoffs that move.
-- Run once in Supabase after 0022.
--
-- 1. recurring_items: a payday can be 'daily', handed over on the weekdays
--    in pay_weekdays (0 Sunday to 6 Saturday; null: every day). day1 is the
--    first of them. Only paydays can be daily.
--
-- 2. payroll_settings.monthly_pay: your rate is per month, not per day.
--    Each payday's base is its share of it (half, twice a month), and a work
--    day you miss takes off monthly_pay / 22. daily_rate keeps that ÷ 22 for
--    late and overtime. Null: your rate is per day (daily_rate). The same
--    column on payroll_pay_changes, for a raise from one cutoff on.
--
-- 3. payroll_settings.saturday, sunday: 'off' (the default), 'regular' (a
--    work day like Monday) or 'overtime' (worked hours paid at the overtime
--    rate, not a day's rate).
--
-- 4. payroll_cutoff_changes: one cutoff on other dates than usual (your
--    company ended it a day early), and the day it's paid if that moved.
--    usual_start is the first day it would have had. The cutoffs either side
--    move to meet it, so no day is in two cutoffs or in none.

-- 1. Daily paydays. The old checks list the frequencies; swap them for ones
-- with 'daily'. (Their names were made up by Postgres, so find them.)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.recurring_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%twice_monthly%'
      and conname <> 'recurring_items_pay_amounts_check'
  loop
    execute format('alter table public.recurring_items drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.recurring_items
  add constraint recurring_items_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly', 'twice_monthly'));

alter table public.recurring_items
  add constraint recurring_items_days_check check (
    (frequency in ('daily', 'weekly') and day1 between 0 and 6 and day2 is null)
    or (frequency = 'monthly' and day1 between 1 and 31 and day2 is null)
    or (frequency = 'twice_monthly' and day1 between 1 and 31 and day2 between 1 and 31 and day1 < day2)
  );

alter table public.recurring_items
  add constraint recurring_items_daily_payday_check check (frequency <> 'daily' or kind = 'payday');

alter table public.recurring_items add column pay_weekdays smallint[];
alter table public.recurring_items
  add constraint recurring_items_pay_weekdays_check check (
    pay_weekdays is null
    or (
      frequency = 'daily'
      and cardinality(pay_weekdays) between 1 and 7
      and pay_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    )
  );

-- 2 and 3. Rate per month, and weekends.
alter table public.payroll_settings
  add column monthly_pay numeric(14, 2) check (monthly_pay > 0),
  add column saturday text not null default 'off' check (saturday in ('off', 'regular', 'overtime')),
  add column sunday text not null default 'off' check (sunday in ('off', 'regular', 'overtime'));

alter table public.payroll_pay_changes
  add column monthly_pay numeric(14, 2) check (monthly_pay > 0);

-- 4. Cutoffs on other dates.
create table public.payroll_cutoff_changes (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  usual_start  date not null,
  starts_on    date not null,
  ends_on      date not null,
  -- Null: paid on the usual payday.
  paid_on      date,
  created_at   timestamptz not null default now(),

  primary key (user_id, usual_start),
  check (starts_on <= ends_on),
  check (paid_on is null or paid_on >= starts_on)
);

alter table public.payroll_cutoff_changes enable row level security;

create policy "own payroll cutoff changes" on public.payroll_cutoff_changes
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.payroll_cutoff_changes to authenticated;
revoke all on public.payroll_cutoff_changes from anon;

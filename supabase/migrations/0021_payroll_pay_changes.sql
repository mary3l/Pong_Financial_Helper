-- Your own cutoff days, and pay that changes from one cutoff on. Run once in
-- Supabase after 0013.
--
-- 1. payroll_settings.cutoff_day1, cutoff_day2: the days your two cutoffs
--    start. 3 and 18 means 3–17 and 18–2; each is paid on the first payday
--    after it ends. Null: the 1st and 16th (1–15 and 16–end).
--
-- 2. payroll_pay_changes:
-- A raise, new hours or a new start time from a given cutoff: cutoffs before
-- it keep the old pay, so past paydays and the income tax on them don't
-- change. Cutoffs before the first change use the rate in payroll_settings.
-- Contributions (SSS, PhilHealth, Pag-IBIG) follow the pay of the cutoff
-- you're in now.

alter table public.payroll_settings
  add column cutoff_day1 smallint check (cutoff_day1 between 1 and 28),
  add column cutoff_day2 smallint check (cutoff_day2 between 1 and 28);
alter table public.payroll_settings
  add constraint payroll_settings_cutoff_days_check
  check ((cutoff_day1 is null) = (cutoff_day2 is null) and (cutoff_day1 is null or cutoff_day1 < cutoff_day2));

create table public.payroll_pay_changes (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The first day of the cutoff it starts with.
  starts_on      date not null,
  daily_rate     numeric(14, 2) not null check (daily_rate > 0),
  hours_per_day  numeric(4, 2) not null check (hours_per_day > 0 and hours_per_day <= 24),
  start_time     time not null,
  overtime_rate  numeric(4, 2) not null check (overtime_rate between 1 and 5),
  created_at     timestamptz not null default now(),

  primary key (user_id, starts_on)
);

alter table public.payroll_pay_changes enable row level security;

create policy "own payroll pay changes" on public.payroll_pay_changes
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.payroll_pay_changes to authenticated;
revoke all on public.payroll_pay_changes from anon;

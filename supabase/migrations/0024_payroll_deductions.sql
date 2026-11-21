-- Contributions your office takes from your pay (GSIS, a union fee, a loan
-- your agency collects). Run once in Supabase after 0023.
--
-- Each is a monthly amount taken from the month's last payday, so that
-- payday's estimate is gross pay minus these. They aren't bills: nothing
-- goes to Money going out or Pay ahead. SSS, PhilHealth and Pag-IBIG you pay
-- yourself stay in payroll_settings (0013, 0018).

create table public.payroll_deductions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  amount      numeric(14, 2) not null check (amount > 0),
  created_at  timestamptz not null default now()
);

create index payroll_deductions_user_idx on public.payroll_deductions (user_id);

alter table public.payroll_deductions enable row level security;

create policy "own payroll deductions" on public.payroll_deductions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.payroll_deductions to authenticated;
revoke all on public.payroll_deductions from anon;

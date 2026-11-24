-- Spending goals, set in Insights. Run once in Supabase after 0027.
--
-- A SMART goal for one category (and, if you pick one, one subcategory):
-- "Spend under ₱1,500 on Transpo › Grab by Nov 30". Specific (the category),
-- measurable (the amount), time-bound (from starts_on to ends_on, both
-- included). What counts toward it is worked out from your transactions,
-- so nothing here changes when you log something.

create table public.spending_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- A category key, like transactions.category (up to 40 characters since 0008).
  category     text not null check (char_length(category) between 1 and 40),
  -- Like transactions.subcategory (0015); matched ignoring case.
  subcategory  text check (subcategory is null or char_length(btrim(subcategory)) between 1 and 40),
  limit_amount numeric(12, 2) not null check (limit_amount > 0 and limit_amount <= 99999999.99),
  starts_on    date not null,
  ends_on      date not null,
  created_at   timestamptz not null default now(),
  -- At most a year, and never ending before it starts.
  check (ends_on >= starts_on and ends_on <= starts_on + 366)
);

create index spending_goals_user_idx on public.spending_goals (user_id, ends_on);

alter table public.spending_goals enable row level security;

create policy "own goals" on public.spending_goals
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.spending_goals to authenticated;
revoke all on public.spending_goals from anon;

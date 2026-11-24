-- Your wishlist, in Plan › Wishlist. Run once in Supabase after 0028.
--
-- Plans you're thinking about, like "Travel to Siargao, ₱18,000, sometime
-- from February to May". Pong picks the gentlest date and way to pay for
-- each one on its own, from your forecast: nothing here is in the forecast
-- until you tap Make it real, which saves Pong's pick as planned expenses
-- (planned_expenses) and marks the plan 'scheduled'.

create table public.wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 50),
  amount      numeric(14, 2) not null check (amount > 0),
  -- An expense category key, like planned_expenses.category (up to 40 since 0008).
  category    text not null check (length(category) <= 40),
  -- The window Pong looks in: from earliest, up to by_date (or a year on).
  earliest    date not null,
  by_date     date check (by_date is null or by_date >= earliest),
  -- If it goes on a card or BNPL: the fee in % a month, like Add's payment plan.
  fee_rate    numeric(4, 2) not null default 0 check (fee_rate between 0 and 10),
  status      text not null default 'idea' check (status in ('idea', 'scheduled')),
  created_at  timestamptz not null default now()
);

create index wishlist_items_user_idx on public.wishlist_items (user_id);

alter table public.wishlist_items enable row level security;

create policy "own wishlist" on public.wishlist_items
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.wishlist_items to authenticated;
revoke all on public.wishlist_items from anon;

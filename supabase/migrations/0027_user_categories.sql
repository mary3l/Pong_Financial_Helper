-- Your own categories, added in Settings › Categories. Run once in Supabase
-- after 0026.
--
-- The built-in ones (Food, Transpo, Salary…) stay in the app's code. Yours
-- sit beside them: a name, one of the app's icons and colours, and whether
-- it's for expenses or income. Entries keep the category's key (u_milk_tea),
-- like they do for the built-in ones (transactions.category, budgets.category:
-- plain text, up to 40 characters since 0008), so renaming one renames it
-- everywhere. Hidden ones aren't offered for new entries; old ones keep it.

create table public.user_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('expense', 'income')),
  key         text not null check (key ~ '^u_[a-z0-9_]{1,36}$'),
  label       text not null check (char_length(btrim(label)) between 1 and 30),
  icon        text not null check (char_length(icon) between 1 and 400),
  tint        text not null check (tint ~ '^bg-[a-z-]{1,30}$'),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, key)
);

create index user_categories_user_idx on public.user_categories (user_id);

alter table public.user_categories enable row level security;

create policy "own categories" on public.user_categories
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_categories to authenticated;
revoke all on public.user_categories from anon;

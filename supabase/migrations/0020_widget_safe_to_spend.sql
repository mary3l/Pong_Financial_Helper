-- Home screen widget: Safe to spend instead of Spent today. Run once in
-- Supabase after 0019 (and 0009, 0010).
--
-- Safe to spend needs your bills, installments, pay and people, which is too
-- much to work out in SQL. So each time Home works it out, the app saves
-- today's daily amount on your widget key (one row, only if you made a key):
--
--   sts_on           the day it was worked out (Philippine time)
--   sts_per_day      that day's amount a day, before anything spent
--   sts_next_payday  the payday it lasts until
--
-- The widget then takes what you've spent today off that amount, live, with
-- the same rule as Home: expenses from Spending wallets (cash, bank,
-- e-wallet), not counting bills, planned expenses and installments you
-- marked paid, since those were already set aside. The daily amount holds
-- still until payday, so a number from an earlier day is still a fair guide;
-- the widget says how old it is. After payday it asks you to open the app.

alter table public.widget_keys
  add column sts_on date,
  add column sts_per_day numeric(14, 2),
  add column sts_next_payday date;

-- What the widget shows, for the owner of `widget_key`, or null when the key
-- is wrong. Read-only, like widget_spent_today (kept for older widgets).
create function public.widget_safe_to_spend(widget_key text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  with owner as (
    select user_id, sts_on, sts_per_day, sts_next_payday
    from public.widget_keys
    where key_hash = encode(sha256(convert_to(widget_key, 'UTF8')), 'hex')
  ),
  day as (
    select (now() at time zone 'Asia/Manila')::date as on_date
  ),
  spent as (
    select t.id, t.amount, t.category, t.note, a.name as wallet, t.created_at
    from public.transactions t
    join owner o on o.user_id = t.user_id
    join public.accounts a on a.id = t.account_id
    cross join day d
    where t.type = 'expense'
      and t.occurred_on = d.on_date
      and a.type in ('cash', 'bank', 'ewallet')
      and a.purpose = 'spending'
      and not exists (select 1 from public.bill_payments b where b.transaction_id = t.id)
      and not exists (select 1 from public.planned_expenses p where p.transaction_id = t.id)
      and not exists (
        select 1 from public.scheduled_payments s
        where s.transfer_txn_id = t.id or s.fee_txn_id = t.id
      )
  ),
  totals as (
    select coalesce(sum(amount), 0) as total, count(*) as count from spent
  ),
  -- The saved amount still applies until payday.
  sts as (
    select o.sts_on, o.sts_per_day, o.sts_next_payday
    from owner o cross join day d
    where o.sts_per_day is not null and o.sts_next_payday > d.on_date
  )
  select json_build_object(
    'date', (select on_date from day),
    'perDay', (select sts_per_day from sts),
    'left', (select sts_per_day - (select total from totals) from sts),
    'asOf', (select sts_on from sts),
    'nextPayday', (select sts_next_payday from sts),
    'daysLeft', (select sts_next_payday - (select on_date from day) from sts),
    'total', (select total from totals),
    'count', (select count from totals),
    'items', coalesce(
      (select json_agg(json_build_object(
                'amount', s.amount, 'category', s.category, 'note', s.note, 'wallet', s.wallet)
              order by s.created_at desc)
       from (select * from spent order by created_at desc limit 8) s),
      '[]'::json)
  )
  where exists (select 1 from owner);
$$;

revoke all on function public.widget_safe_to_spend(text) from public;
grant execute on function public.widget_safe_to_spend(text) to anon, authenticated;

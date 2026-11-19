-- QA Phase 4: the home screen widget's functions. They run with the owner's
-- rights (security definer) and signed-out callers may run them, so the
-- widget key is the only thing standing between a stranger and your spending.
-- Run with `npm run test:db` (needs `npm run db:start` first).
begin;
create extension if not exists pgtap with schema extensions;

-- Two users, each with a widget key, a spending wallet and today's expenses.
create function pg_temp.seed(uid uuid, key text, spent numeric[]) returns void
language plpgsql as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  wallet uuid := gen_random_uuid();
  amount numeric;
begin
  insert into auth.users (id, email) values (uid, uid || '@example.com');
  insert into public.accounts (id, user_id, name, type) values (wallet, uid, 'GCash', 'ewallet');
  foreach amount in array spent loop
    insert into public.transactions (user_id, type, amount, account_id, category, occurred_on)
      values (uid, 'expense', amount, wallet, 'food', today);
  end loop;
  -- Yesterday doesn't count toward today.
  insert into public.transactions (user_id, type, amount, account_id, category, occurred_on)
    values (uid, 'expense', 999, wallet, 'food', today - 1);
  insert into public.widget_keys (user_id, key_hash, sts_on, sts_per_day, sts_next_payday)
    values (uid, encode(sha256(convert_to(key, 'UTF8')), 'hex'), today, 500, today + 5);
end $$;

select pg_temp.seed('11111111-1111-1111-1111-111111111111', 'key-of-a', array[120, 30]);
select pg_temp.seed('22222222-2222-2222-2222-222222222222', 'key-of-b', array[5000]);

select plan(10);

-- As a signed-out caller, the way the widget calls them.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- widget_spent_today ------------------------------------------------------------

select ok(public.widget_spent_today('not-a-key') is null,
          'widget_spent_today: a wrong key gets nothing');

select ok(public.widget_spent_today('') is null,
          'widget_spent_today: an empty key gets nothing');

select is((public.widget_spent_today('key-of-a') ->> 'total')::numeric, 150::numeric,
          'widget_spent_today: the right key gets only its owner''s spending today');

select is((public.widget_spent_today('key-of-a') ->> 'count')::int, 2,
          'widget_spent_today: and only its owner''s expenses');

select is((public.widget_spent_today('key-of-b') ->> 'total')::numeric, 5000::numeric,
          'widget_spent_today: user B''s key gets user B''s spending');

-- widget_safe_to_spend ----------------------------------------------------------

select ok(public.widget_safe_to_spend('not-a-key') is null,
          'widget_safe_to_spend: a wrong key gets nothing');

select is((public.widget_safe_to_spend('key-of-a') ->> 'left')::numeric, 350::numeric,
          'widget_safe_to_spend: what''s left today is the owner''s 500 a day minus their 150');

select is((public.widget_safe_to_spend('key-of-a') ->> 'count')::int, 2,
          'widget_safe_to_spend: counts only the owner''s expenses');

-- The functions don't open the tables themselves.
select throws_ok('select count(*) from public.widget_keys', '42501', null,
                 'widget_keys: signed-out callers still can''t read the keys table');

select throws_ok('select count(*) from public.transactions', '42501', null,
                 'transactions: or anyone''s transactions');

select * from finish();
rollback;

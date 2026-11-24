-- QA Phase 4: each user sees and changes only their own rows.
-- Two users get one linked row in every table; then, as user A:
--   * none of B's rows are visible, and A's own are (so RLS isn't just blocking everything)
--   * updating or deleting B's rows touches 0 rows
--   * handing A's own row to B is refused (42501)
-- and as a signed-out visitor (anon) every table is refused outright.
-- Run with `npm run test:db` (needs `npm run db:start` first).
begin;
create extension if not exists pgtap with schema extensions;

-- Helpers, rolled back with everything else ----------------------------------

create schema tests;
grant usage on schema tests to anon, authenticated;

create table tests.tables (name text primary key);
insert into tests.tables (name) values
  ('accounts'), ('transactions'), ('recurring_items'), ('bill_payments'),
  ('planned_expenses'), ('budgets'), ('installment_plans'), ('scheduled_payments'),
  ('person_entries'), ('products'), ('product_prices'), ('grocery_trips'),
  ('grocery_items'), ('widget_keys'), ('payroll_settings'), ('payroll_days'),
  ('payroll_overtime'), ('payroll_pay_changes'), ('payroll_cutoff_changes'),
  ('user_categories'), ('wishlist_items');
grant select on tests.tables to anon, authenticated;

-- Each user's wallet id, for the "guessed id" test (the test knows it; RLS doesn't help).
create table tests.wallets (owner uuid primary key, wallet uuid not null);
grant select on tests.wallets to authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

-- Rows of `tbl` the current role can see that match `cond`.
create function tests.count_rows(tbl text, cond text default 'true') returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where %s', tbl, cond) into n;
  return n;
end $$;

-- Rows a statement changed.
create function tests.changed(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- One row in every table for `uid`, all linked the way the app links them.
create function tests.seed(uid uuid, key text) returns void language plpgsql as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  wallet uuid := gen_random_uuid();
  person uuid := gen_random_uuid();
  spent uuid := gen_random_uuid();
  lent uuid := gen_random_uuid();
  bill uuid := gen_random_uuid();
  plan uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  trip uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (uid, uid || '@example.com');
  insert into public.accounts (id, user_id, name, type) values
    (wallet, uid, 'Cash', 'cash'), (person, uid, 'Ana', 'person');
  insert into tests.wallets (owner, wallet) values (uid, wallet);
  insert into public.transactions (id, user_id, type, amount, account_id, to_account_id, category, occurred_on) values
    (spent, uid, 'expense', 120, wallet, null, 'food', today),
    (lent, uid, 'transfer', 500, wallet, person, null, today);
  insert into public.recurring_items (id, user_id, kind, name, amount, frequency, day1)
    values (bill, uid, 'bill', 'Rent', 8000, 'monthly', 5);
  insert into public.bill_payments (user_id, recurring_item_id, due_on, transaction_id)
    values (uid, bill, today, spent);
  insert into public.planned_expenses (user_id, name, amount, category, due_on)
    values (uid, 'Phone', 9999, 'shopping', today + 30);
  insert into public.budgets (user_id, category, amount) values (uid, 'food', 2500);
  insert into public.installment_plans (id, user_id, kind, account_id, name, principal, months, first_due)
    values (plan, uid, 'bnpl', wallet, 'Shoes', 300, 3, today + 15);
  insert into public.scheduled_payments (user_id, plan_id, seq, due_on, amount, principal_part)
    values (uid, plan, 1, today + 15, 100, 100);
  insert into public.person_entries (user_id, transaction_id, person_id, kind)
    values (uid, lent, person, 'lend');
  insert into public.products (id, user_id, barcode, name) values (product, uid, '4800016', 'Milk');
  insert into public.product_prices (user_id, product_id, store, price) values (uid, product, 'SM', 95.25);
  insert into public.grocery_trips (id, user_id, store, account_id, scanned_total, transaction_id)
    values (trip, uid, 'SM', wallet, 95.25, spent);
  insert into public.grocery_items (user_id, trip_id, product_id, name, price)
    values (uid, trip, product, 'Milk', 95.25);
  insert into public.widget_keys (user_id, key_hash)
    values (uid, encode(sha256(convert_to(key, 'UTF8')), 'hex'));
  insert into public.payroll_settings (user_id, daily_rate) values (uid, 1000);
  insert into public.payroll_days (user_id, work_date, status) values (uid, today, 'worked');
  insert into public.payroll_overtime (user_id, work_date, starts_at, ends_at)
    values (uid, today, '17:00', '18:00');
  insert into public.payroll_pay_changes (user_id, starts_on, daily_rate, hours_per_day, start_time, overtime_rate)
    values (uid, today + 1, 1200, 8, '08:00', 1);
  insert into public.payroll_cutoff_changes (user_id, usual_start, starts_on, ends_on)
    values (uid, today, today - 2, today + 12);
  insert into public.user_categories (user_id, type, key, label, icon, tint)
    values (uid, 'expense', 'u_milk_tea', 'Milk tea', 'M5 12h.01', 'bg-plum-tint');
  insert into public.wishlist_items (user_id, name, amount, category, earliest)
    values (uid, 'Siargao trip', 18000, 'fun', today + 30);
end $$;

select tests.seed('11111111-1111-1111-1111-111111111111', 'key-of-a');
select tests.seed('22222222-2222-2222-2222-222222222222', 'key-of-b');

-- 6 checks per table (5 as user A, 1 signed out) + 4 more.
select plan(21 * 6 + 4);

-- As user A ---------------------------------------------------------------------

select tests.as_user('11111111-1111-1111-1111-111111111111');

select is(tests.count_rows(name, 'user_id <> auth.uid()'), 0::bigint,
          name || ': user A sees none of user B''s rows')
from tests.tables order by name;

select cmp_ok(tests.count_rows(name), '>', 0::bigint,
              name || ': user A still sees their own rows')
from tests.tables order by name;

select is(tests.changed(format(
            'update public.%I set user_id = user_id where user_id = %L',
            name, '22222222-2222-2222-2222-222222222222')), 0::bigint,
          name || ': user A can''t update user B''s rows')
from tests.tables order by name;

select is(tests.changed(format(
            'delete from public.%I where user_id = %L',
            name, '22222222-2222-2222-2222-222222222222')), 0::bigint,
          name || ': user A can''t delete user B''s rows')
from tests.tables order by name;

select throws_ok(format('update public.%I set user_id = %L',
                        name, '22222222-2222-2222-2222-222222222222'),
                 '42501', null,
                 name || ': user A can''t hand their row to user B')
from tests.tables order by name;

-- Inserting a row in someone else's name, or pointing at their wallet.
select throws_ok(
  $$ insert into public.budgets (user_id, category, amount)
     values ('22222222-2222-2222-2222-222222222222', 'fun', 100) $$,
  '42501', null,
  'budgets: user A can''t insert a row owned by user B'
);

-- A guessed (or leaked) wallet id: the (account, owner) foreign key refuses it.
select throws_ok(
  format($$ insert into public.transactions (type, amount, account_id, category)
            values ('expense', 1, %L, 'food') $$,
         (select wallet from tests.wallets where owner = '22222222-2222-2222-2222-222222222222')),
  '23503', null,
  'transactions: user A can''t spend from user B''s wallet, even knowing its id'
);

select is(
  (select count(*) from public.account_balances
   where user_id <> '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'account_balances: user A sees no balance of user B''s'
);

-- As a signed-out visitor ---------------------------------------------------------

select tests.as_anon();

select throws_ok(format('select count(*) from public.%I', name), '42501', null,
                 name || ': signed-out visitors are refused')
from tests.tables order by name;

select throws_ok('select count(*) from public.account_balances', '42501', null,
                 'account_balances: signed-out visitors are refused');

select * from finish();
rollback;

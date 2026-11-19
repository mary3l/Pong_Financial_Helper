-- QA Phase 4: the security rules every table and function must follow.
-- Read from the catalog, so a table added later is checked too.
-- Run with `npm run test:db` (needs `npm run db:start` first).
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- Row-level security ------------------------------------------------------

select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table in public has row-level security turned on'
);

select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) $$,
  'every table in public has at least one policy (RLS with no policy hides everything)'
);

select is_empty(
  $$ select tablename || ': ' || policyname from pg_policies
     where schemaname = 'public' and roles && array['anon', 'public']::name[] $$,
  'no policy lets signed-out (anon) or every role (public) in'
);

select is_empty(
  $$ select tablename || ': ' || policyname from pg_policies
     where schemaname = 'public'
       and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%' $$,
  'every policy is tied to the signed-in user (auth.uid())'
);

-- Signed-out access ----------------------------------------------------------

select is_empty(
  $$ select table_name || ': ' || privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public' $$,
  'signed-out (anon) has no privileges on any table or view'
);

select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
       and not coalesce('security_invoker=true' = any (c.reloptions), false) $$,
  'every view runs with the caller''s rights (security_invoker), so RLS applies through it'
);

-- Functions that bypass RLS -------------------------------------------------

select results_eq(
  $$ select p.proname::text collate "default" from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
     order by 1 $$,
  $$ values ('widget_safe_to_spend'), ('widget_spent_today') $$,
  'only the two widget functions run with the owner''s rights (security definer)'
);

select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') $$,
  'every security definer function pins its search_path'
);

select results_eq(
  $$ select p.proname::text collate "default" from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and has_function_privilege('anon', p.oid, 'execute')
     order by 1 $$,
  $$ values ('widget_safe_to_spend'), ('widget_spent_today') $$,
  'signed-out callers can run only the widget functions'
);

select * from finish();
rollback;

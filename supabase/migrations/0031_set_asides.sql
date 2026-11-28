-- Saving up for a wishlist plan. Run once in Supabase after 0030.
--
-- A plan with a "save from" and a "ready by" date is made real as set-asides:
-- planned_expenses with type 'set_aside', one per payday between the dates.
-- Each moves money from a spending wallet into the savings wallet in
-- to_account_id, so the forecast counts it as money out of your spending on
-- its payday. Marking one done logs a transfer, never spending.

alter table public.planned_expenses drop constraint planned_expenses_type_check;
alter table public.planned_expenses
  add constraint planned_expenses_type_check
    check (type in ('expense', 'income', 'set_aside'));

-- Only ever one of your own wallets. Deleting it keeps the set-aside and
-- clears the link; Mark done then says to pick another.
alter table public.planned_expenses
  add column to_account_id uuid,
  add constraint planned_expenses_to_account_fkey foreign key (to_account_id, user_id)
    references public.accounts (id, user_id) on delete set null (to_account_id);

comment on table public.planned_expenses is
  'One-off planned cashflows: type expense (money out), income (money in), or set_aside (money moved into the savings wallet in to_account_id).';

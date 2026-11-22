-- Credit cards, told apart from BNPL. Run once in Supabase after 0025.
--
-- Both are credit lines (type 'credit_line': a limit, a statement cutoff and a
-- due day). A credit card is revolving: a purchase goes on the statement's
-- bill in full ("straight") unless you turn it into installments, it has no
-- BNPL cap, and you can pay it early. BNPL (SPayLater, Atome) works as before.
-- Every existing credit line stays BNPL.

alter table public.accounts
  add column credit_kind text not null default 'bnpl'
    check (credit_kind in ('bnpl', 'card')),
  add constraint accounts_card_is_credit_line
    check (credit_kind = 'bnpl' or type = 'credit_line');

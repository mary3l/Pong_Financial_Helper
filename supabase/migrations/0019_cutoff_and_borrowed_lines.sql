-- Statement cutoff days, and plans someone else pays on your credit line.
-- Run once in Supabase after 0018.
--
-- 1. accounts.cutoff_day: the day a credit line's statement closes. A
--    purchase on or before it goes on the bill due after it; one after it
--    waits for the next statement. Null: Pong guesses (the next due day at
--    least a week after buying), like before.
--
-- 2. installment_plans.person_id: someone used your Atome or SPayLater (Tita
--    Flora's phone) and pays the installments. It's not your debt:
--
--      Their purchase      TRANSFER credit line -> person (pautang), never
--                          your spending.
--      They pay it         TRANSFER person -> credit line, straight to the
--                          bill. Your wallets never move, so the forecast,
--                          Safe to spend and Pong's BNPL cap leave it out.
--      You cover it        Pay bill from your wallet as usual; they still
--                          owe you.

alter table public.accounts
  add column cutoff_day smallint check (cutoff_day between 1 and 31);
alter table public.accounts
  add constraint accounts_cutoff_day_type_check check (cutoff_day is null or type = 'credit_line') not valid;

alter table public.installment_plans add column person_id uuid;
alter table public.installment_plans
  add constraint installment_plans_person_fk
  foreign key (person_id, user_id) references public.accounts (id, user_id) on delete set null (person_id);

create index installment_plans_person_idx on public.installment_plans (person_id) where person_id is not null;

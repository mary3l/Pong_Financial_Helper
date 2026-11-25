-- Links scheduled payments to the wishlist plan they came from. Run once in
-- Supabase after 0029.
--
-- Make it real saves a plan's payments as planned_expenses. With wish_id,
-- Plan › Scheduled shows them as one plan, and removing or changing the plan
-- in Plan › Wishlist takes its unpaid payments with it. Payments you add
-- yourself, or from Can I afford this?, have no wish_id.

-- Only ever one of your own plans, like account_id and transaction_id.
alter table public.wishlist_items
  add constraint wishlist_items_id_user_key unique (id, user_id);

alter table public.planned_expenses
  add column wish_id uuid,
  add constraint planned_expenses_wish_fkey foreign key (wish_id, user_id)
    references public.wishlist_items (id, user_id) on delete set null (wish_id);

create index planned_expenses_wish_idx on public.planned_expenses (wish_id)
  where wish_id is not null;

-- Plans made real before this: their payments are named after them, like
-- "Siargao Trip", "Siargao Trip (2 of 6)" or "Siargao Trip · BPI Card (2 of 6)".
update public.planned_expenses p
set wish_id = w.id
from public.wishlist_items w
where w.status = 'scheduled'
  and p.user_id = w.user_id
  and p.wish_id is null
  and (
    p.name = w.name
    or left(p.name, char_length(w.name) + 2) = w.name || ' ('
    or left(p.name, char_length(w.name) + 3) = w.name || ' · '
  );

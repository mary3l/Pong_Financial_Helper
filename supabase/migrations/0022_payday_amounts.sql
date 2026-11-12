-- Paydays that aren't all the same, and payroll cutoffs that follow your
-- payday. Run once in Supabase after 0021.
--
-- 1. recurring_items.pay_weeks (weekly payday only): the weeks of the month
--    that pay, 1 to 5. {1,3} is the 1st and 3rd Friday. Null: every week.
--
-- 2. recurring_items.pay_amounts (payday only): what each payday brings
--    when they differ. Weekly: five, one per week of the month (the 1st
--    Friday's, the 2nd's, ...). Twice a month: two, for day1 and day2. A
--    null in it uses the payday's own amount. Null: every payday is amount.
--    The payroll calculator clears it: it works out each payday itself.
--
-- 3. payroll_settings.cutoff_weekday, cutoff_month_day: the payroll
--    calculator's cutoffs follow your payday. Weekly pay: a cutoff is a week
--    starting on cutoff_weekday (0 Sunday to 6 Saturday; null: Monday).
--    Monthly pay: a month starting on cutoff_month_day (null: the 1st).
--    Twice a month keeps cutoff_day1 and cutoff_day2 (0021).

alter table public.recurring_items
  add column pay_weeks smallint[],
  add column pay_amounts numeric(14, 2)[];

alter table public.recurring_items
  add constraint recurring_items_pay_weeks_check check (
    pay_weeks is null
    or (
      kind = 'payday'
      and frequency = 'weekly'
      and cardinality(pay_weeks) between 1 and 5
      and pay_weeks <@ array[1, 2, 3, 4, 5]::smallint[]
    )
  );

alter table public.recurring_items
  add constraint recurring_items_pay_amounts_check check (
    pay_amounts is null
    or (
      kind = 'payday'
      and (
        (frequency = 'weekly' and cardinality(pay_amounts) = 5)
        or (frequency = 'twice_monthly' and cardinality(pay_amounts) = 2)
      )
      -- Every amount above 0 (nulls allowed).
      and not (0 >= any (pay_amounts))
    )
  );

alter table public.payroll_settings
  add column cutoff_weekday smallint check (cutoff_weekday between 0 and 6),
  add column cutoff_month_day smallint check (cutoff_month_day between 1 and 28);

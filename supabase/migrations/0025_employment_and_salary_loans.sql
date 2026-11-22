-- Pay from gross: how you earn, contributions Pong estimates, and loans your
-- office takes from your pay. Run once in Supabase after 0024.
--
-- Employees (government or private) have GSIS or SSS, PhilHealth, Pag-IBIG
-- and withholding tax taken from their pay. Those are payroll_deductions
-- with a kind; an amount left empty is Pong's estimate from your pay, until
-- you type the one on your payslip. Self-employed keep paying theirs
-- themselves (payroll_settings.pay_*), as before.
--
-- A salary loan (GSIS MPL, a Pag-IBIG or SSS salary loan) is a loan whose
-- payments come off the month's last payday instead of out of a wallet. It
-- isn't a bill in the forecast: the payday is already that much lower.

alter table public.payroll_settings
  add column employment text not null default 'self'
    check (employment in ('government', 'private', 'self', 'none'));

alter table public.payroll_deductions
  add column kind text not null default 'other'
    check (kind in ('gsis', 'sss', 'philhealth', 'pagibig', 'tax', 'other')),
  add column taken text not null default 'last'
    check (taken in ('last', 'each')),
  alter column amount drop not null;

alter table public.installment_plans
  add column pay_by text not null default 'wallet'
    check (pay_by in ('wallet', 'salary'));

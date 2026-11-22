# Pong Money

A cashflow helper for Filipino earners, with Pong the turtle. It tells you how much you can spend
this week while every bill, loan and BNPL payment still gets paid on time.

Built with Next.js 16 (App Router, Cache Components) and Supabase.

## Features

- **Left this week**: a weekly spending pool with a daily pace. Going over one day comes out of the
  rest of the week; nothing you skip is lost.
- **Add**: expense, income or transfer with a required description, no guessed wallet or category,
  and wallets grouped (Wallets, Savings, Credit cards, BNPL, Loans, People).
- **Money**: wallets, savings goals, dollar time deposits, credit cards, BNPL and loans, with
  interest estimates for MariBank, GoTyme and Maya.
- **Pay**: gross pay, cutoffs and paydays. Pong estimates GSIS or SSS, PhilHealth, Pag-IBIG and
  withholding tax, and takes salary loans off the payday.
- **Plan**: 90-day forecast, scheduled bills and income, bills by payday, budgets per kinsenas, and
  "Can I afford this?".
- **Utang & pautang**: lend, borrow and split bills, with a shareable breakdown.
- **Grocery mode**: scan barcodes while you shop and check out as one expense.
- **Settings**: your own categories, payday and bills, and the iPhone home screen widget.
- **First-run setup**: spending wallets → savings → your pay → what's taken → what you owe → bills.

## Getting started

Needs **Node 24** or newer. Docker Desktop is only needed for the database and end-to-end tests.

```bash
npm install
cp .env.example .env.local   # add your Supabase URL and publishable key
npm run dev                  # http://localhost:3000
```

Then, in Supabase:

1. **SQL Editor**: run each file in `supabase/migrations/` once, in order.
   [`supabase/SQL_GUIDE.md`](supabase/SQL_GUIDE.md) walks through steps 1–27, with a check query for each.
2. **Authentication › URL Configuration**: add `http://localhost:3000/auth/callback` to Redirect URLs.
3. Optional: enable **Google** under Authentication › Sign In / Providers. Email sign-in links
   work without it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run qa` | Typecheck, lint, format check and unit tests (runs before every push) |
| `npm test` | Unit tests (Vitest): `unit` for money rules and actions, `dom` for components |
| `npm run test:coverage` | Unit tests with coverage floors |
| `npm run db:start` / `db:stop` | Local Supabase in Docker |
| `npm run test:db` | Database tests (pgTAP): row-level security on every table |
| `npm run e2e:env` → `npm run e2e` | End-to-end tests (Playwright) against the local Supabase |
| `npm run lighthouse` | Lighthouse checks |
| `npm run format` | Prettier |

No Docker on your PC? Open the repo in GitHub Codespaces: see [`.devcontainer/README.md`](.devcontainer/README.md).

## Project layout

| Path | What's there |
|---|---|
| `src/app/(app)/` | Signed-in screens: Home, Activity, Plan, Money, Pay, Settings, Grocery |
| `src/app/(app)/@modal/(.)add` | Add over the current page (`/add` opens it as a page) |
| `src/app/setup/` | First-run setup; the proxy sends Home there until `setup_done` |
| `src/app/*-actions.ts` | Server Actions (writes) |
| `src/lib/data.ts` | Reads |
| `src/lib/*.ts` | Pure money rules, each with a `*.test.ts` beside it |
| `src/components/` | Shared UI: the Add form, Pong, pickers, keypad |
| `src/proxy.ts` | Session refresh and sign-in redirects |
| `supabase/migrations/` | Database schema, in order |
| `supabase/tests/database/` | Row-level security tests |
| `e2e/` | Playwright tests |
| `public/pong-widget.js` | iPhone home screen widget (Scriptable) |
| `public/sw.js` | Service worker: offline page and cached build files |

## Money rules

| Rule | Where |
|---|---|
| Transfers between your own wallets, savings and people are never spending or income | migrations |
| Only **Spending** wallets count toward this week; savings count in Net worth | `money.ts` |
| Left this week: planned from Monday so every bill stays paid, with a pace for each day left | `payment-plan.ts` |
| A BNPL or card purchase is spending on the day you buy; paying its bill is a transfer, and only fees are spending | `installments.ts` |
| A purchase goes on the bill after its statement cutoff; without one, the next due day a week out | `installments.ts` |
| BNPL is capped by your take-home and spending, and held on each bill's due day; credit cards aren't capped | `bnpl.ts`, `payment-plan.ts` |
| A loan's money is a transfer in, never income; each payment is principal (transfer) plus interest (expense) | `installments.ts` |
| Salary loans and office deductions come off the payday, never as bills (no double count) | `payroll.ts` |
| Contribution and tax amounts are estimates until you type your payslip's | `payroll.ts` (`RATES`) |
| Pautang only counts in the forecast if you choose, and never once it's late | `people.ts` |
| Interest is estimated after the 20% final tax; Pong never adds it by itself | `money.ts` |

## Docs

- [`supabase/SQL_GUIDE.md`](supabase/SQL_GUIDE.md): database setup, step by step
- [`AGENTS.md`](AGENTS.md): notes for coding agents on this Next.js version
- The comments at the top of each `src/lib/*.ts` file explain its rules in full

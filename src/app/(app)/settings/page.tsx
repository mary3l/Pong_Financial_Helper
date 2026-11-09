import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/actions";
import { DisplayNameForm } from "@/components/display-name-form";
import { ChevronIcon } from "@/components/icons";
import { ThemePicker } from "@/components/theme";
import { WidgetSetup } from "@/components/widget-setup";
import { getCurrentUser } from "@/lib/auth";
import { getBudgets, getRecurringItems, getWidgetKey } from "@/lib/data";
import { formatShortDay, today } from "@/lib/dates";
import { formatPeso } from "@/lib/money";
import { describeSchedule } from "@/lib/schedule";

export const metadata = { title: "Settings & tools · Pong Money" };

// Design canvas 3.4, opened from the avatar on Home. Rows for later phases
// are listed so the shape of the app is visible, marked "Soon".
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 lg:max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Settings &amp; tools</h1>

      <Group title="PLANNING">
        <Suspense fallback={<Row title="Payday & bills" href="/settings/payday" />}>
          <PaydayRow />
        </Suspense>
        <Row
          title="Scheduled income & expenses"
          detail="Payroll, allowance, rent, tuition: once or on repeat"
          href="/plan/scheduled"
        />
        <Suspense fallback={<Row title="Budgets" href="/plan/budgets" />}>
          <BudgetsRow />
        </Suspense>
        <Row title="Can I afford this?" detail="Test a purchase against your forecast" href="/plan/afford" />
        <Row title="Goals (sinking funds)" detail="Set money aside for an emergency fund or a new laptop" soon />
      </Group>

      <Group title="DEBTS & COMMITMENTS">
        <Row title="Utang / Pautang & split bills" detail="Who owes whom" href="/money/people" />
        <Row title="Installments & loans" detail="SPayLater, Atome, SLoan, MariLoan" href="/money" />
        <Row title="Paluwagan" soon />
      </Group>

      <Group title="TOOLS">
        <Row title="Wallets, BNPL & loans" detail="Cash, banks, e-wallets and what you owe" href="/money" />
        <Row title="Grocery mode" detail="Scan as you shop and stay in budget" href="/grocery" />
        <Row title="Payroll calculator" detail="Days worked, late, overtime, SSS, PhilHealth, Pag-IBIG, tax" href="/payroll" />
        <Row title="Import CSV · Export · Backup" soon />
      </Group>

      <section className="flex flex-col gap-4 rounded-3xl bg-card p-6">
        <h2 className="font-display text-xl font-semibold">Home screen widget</h2>
        <Suspense fallback={<div className="h-40 rounded-[14px] bg-line-soft" />}>
          <Widget />
        </Suspense>
      </section>

      <section className="flex flex-col gap-4 rounded-3xl bg-card p-6">
        <h2 className="font-display text-xl font-semibold">Appearance</h2>
        <ThemePicker />
      </section>

      <section className="flex flex-col gap-4 rounded-3xl bg-card p-6">
        <h2 className="font-display text-xl font-semibold">Profile</h2>
        <Suspense fallback={<div className="h-28 rounded-[14px] bg-line-soft" />}>
          <Profile />
        </Suspense>
      </section>

      <section className="flex flex-col gap-4 rounded-3xl bg-card p-6">
        <h2 className="font-display text-xl font-semibold">Account</h2>
        <Suspense fallback={<p className="h-6 w-56 rounded bg-line-soft" />}>
          <SignedInAs />
        </Suspense>
        <form action={signOut}>
          <button
            type="submit"
            className="h-12 rounded-[18px] border-2 border-line px-5 font-bold text-ink hover:bg-mint"
          >
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-extrabold text-muted">{title}</h2>
      <ul className="flex flex-col rounded-[20px] bg-card px-4 py-1">{children}</ul>
    </section>
  );
}

function Row({
  title,
  detail,
  href,
  soon = false,
}: {
  title: string;
  detail?: string;
  href?: string;
  soon?: boolean;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`font-bold ${soon ? "text-muted" : ""}`}>{title}</span>
        {detail && <span className="text-[13px] text-muted">{detail}</span>}
      </span>
      {soon ? (
        <span className="rounded-full bg-sun-tint px-2.5 py-0.5 text-xs font-extrabold text-sun-text">Soon</span>
      ) : (
        <ChevronIcon size={20} className="text-muted" />
      )}
    </>
  );
  return (
    <li className="border-b border-line-soft last:border-0">
      {href ? (
        <Link href={href} className="flex min-h-14 items-center gap-3 py-2.5 text-ink">
          {body}
        </Link>
      ) : (
        <div className="flex min-h-14 items-center gap-3 py-2.5">{body}</div>
      )}
    </li>
  );
}

async function PaydayRow() {
  const items = await getRecurringItems();
  const payday = items.find((i) => i.kind === "payday");
  const bills = items.filter((i) => i.kind === "bill");
  const pay = payday
    ? `${describeSchedule(payday)}${payday.amount ? ` · ${formatPeso(payday.amount)}` : ""}`
    : "Payday not set";
  return (
    <Row
      title="Payday & bills"
      detail={`${pay} · ${bills.length} ${bills.length === 1 ? "bill" : "bills"}`}
      href="/settings/payday"
    />
  );
}

async function BudgetsRow() {
  const budgets = await getBudgets();
  const total = budgets.reduce((sum, b) => sum + b.amount, 0);
  return (
    <Row
      title="Budgets"
      detail={budgets.length ? `${budgets.length} set · ${formatPeso(total)} per kinsenas` : "Limits per kinsenas"}
      href="/plan/budgets"
    />
  );
}

async function Widget() {
  const key = await getWidgetKey();
  if (key === "missing") {
    return (
      <p className="text-[15px] text-muted">
        Run step 9 in <strong className="text-ink">supabase/SQL_GUIDE.md</strong> to turn on the home
        screen widget.
      </p>
    );
  }
  return <WidgetSetup keyMadeOn={key ? `on ${formatShortDay(today(new Date(key.createdAt)))}` : null} />;
}

async function Profile() {
  const user = await getCurrentUser();
  return <DisplayNameForm initialName={user.name} />;
}

async function SignedInAs() {
  const user = await getCurrentUser();
  return (
    <p className="text-muted">
      Signed in as <strong className="text-ink">{user.email}</strong>
    </p>
  );
}

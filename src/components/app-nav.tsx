"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Pong } from "@/components/pong";
import {
  ActivityIcon,
  CalculatorIcon,
  GroceryIcon,
  HomeIcon,
  MoneyIcon,
  PlanIcon,
  PlusIcon,
  ScaleIcon,
  TrendIcon,
} from "@/components/icons";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/activity", label: "Activity", Icon: ActivityIcon },
  { href: "/plan", label: "Plan", Icon: PlanIcon },
  { href: "/money", label: "Money", Icon: MoneyIcon },
];

type IsActive = (href: string) => boolean;

function useIsActive(): IsActive {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

// The pathname isn't known while prerendering pages with a dynamic param
// (like /activity/[id]), so the navs render without a highlight until it is.
const noneActive: IsActive = () => false;

/** Phone and tablet: Home · Activity · + · Plan · Money, fixed to the bottom. */
export function BottomNav() {
  return (
    <Suspense fallback={<BottomNavBar isActive={noneActive} />}>
      <ActiveBottomNav />
    </Suspense>
  );
}

function ActiveBottomNav() {
  return <BottomNavBar isActive={useIsActive()} />;
}

function BottomNavBar({ isActive }: { isActive: IsActive }) {
  const [home, activity, plan, money] = TABS;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid h-[84px] grid-cols-5 items-center rounded-t-3xl bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(18,48,42,0.08)] lg:hidden"
    >
      {[home, activity].map((tab) => (
        <BottomTab key={tab.href} {...tab} active={isActive(tab.href)} />
      ))}
      <Link
        href="/add"
        aria-label="Input transaction"
        className="-mt-8 flex h-[62px] w-[62px] items-center justify-center justify-self-center rounded-[22px] bg-sun text-ink shadow-[0_6px_16px_rgba(255,201,60,0.55)]"
      >
        <PlusIcon size={28} />
      </Link>
      {[plan, money].map((tab) => (
        <BottomTab key={tab.href} {...tab} active={isActive(tab.href)} />
      ))}
    </nav>
  );
}

function BottomTab({ href, label, Icon, active }: (typeof TABS)[number] & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 flex-col items-center justify-center gap-1 text-xs ${
        active ? "font-extrabold text-sea" : "font-bold text-muted"
      }`}
    >
      <Icon size={24} />
      {label}
    </Link>
  );
}

/** Desktop: sidebar with the Add button on top. */
export function Sidebar() {
  return (
    <Suspense fallback={<SidebarPanel isActive={noneActive} />}>
      <ActiveSidebar />
    </Suspense>
  );
}

function ActiveSidebar() {
  return <SidebarPanel isActive={useIsActive()} />;
}

function SidebarPanel({ isActive }: { isActive: IsActive }) {
  return (
    <aside className="sticky top-6 hidden w-64 shrink-0 flex-col gap-5 self-start rounded-[28px] bg-card px-4 py-5 lg:flex">
      <Link href="/" className="flex items-center gap-2 text-ink no-underline">
        <Pong size={48} decorative />
        <span className="font-display text-2xl font-semibold">Pong Money</span>
      </Link>
      <Link
        href="/add"
        className="flex h-[52px] items-center justify-center gap-2 rounded-[18px] bg-sun font-extrabold text-ink"
      >
        <PlusIcon size={20} />
        Input transaction
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-[46px] items-center gap-3 rounded-[14px] px-3.5 text-[15px] ${
                active
                  ? "bg-sea-tint font-extrabold text-sea-dark"
                  : "font-bold text-ink hover:bg-mint"
              }`}
            >
              <Icon size={22} />
              {label}
            </Link>
          );
        })}
        <Link
          href="/grocery"
          aria-current={isActive("/grocery") ? "page" : undefined}
          className={`flex h-[46px] items-center gap-3 rounded-[14px] px-3.5 text-[15px] ${
            isActive("/grocery")
              ? "bg-sea-tint font-extrabold text-sea-dark"
              : "font-bold text-ink hover:bg-mint"
          }`}
        >
          <GroceryIcon size={22} />
          Grocery mode
        </Link>
        <Link
          href="/compare"
          aria-current={isActive("/compare") ? "page" : undefined}
          className={`flex h-[46px] items-center gap-3 rounded-[14px] px-3.5 text-[15px] ${
            isActive("/compare")
              ? "bg-sea-tint font-extrabold text-sea-dark"
              : "font-bold text-ink hover:bg-mint"
          }`}
        >
          <ScaleIcon size={22} />
          Compare prices
        </Link>
        <Link
          href="/payroll"
          aria-current={isActive("/payroll") ? "page" : undefined}
          className={`flex h-[46px] items-center gap-3 rounded-[14px] px-3.5 text-[15px] ${
            isActive("/payroll")
              ? "bg-sea-tint font-extrabold text-sea-dark"
              : "font-bold text-ink hover:bg-mint"
          }`}
        >
          <CalculatorIcon size={22} />
          Pay
        </Link>
        <Link
          href="/insights"
          aria-current={isActive("/insights") ? "page" : undefined}
          className={`flex h-[46px] items-center gap-3 rounded-[14px] px-3.5 text-[15px] ${
            isActive("/insights")
              ? "bg-sea-tint font-extrabold text-sea-dark"
              : "font-bold text-ink hover:bg-mint"
          }`}
        >
          <TrendIcon size={22} />
          Insights
        </Link>
      </nav>
    </aside>
  );
}

import { connection } from "next/server";
import { Suspense } from "react";
import { creditRoom } from "@/lib/bnpl";
import { categoriesFor } from "@/lib/categories";
import {
  getBnplCap,
  getPlanInputs,
  getPlannedExpenses,
  getUserCategories,
  getWishlist,
} from "@/lib/data";
import { today as getToday } from "@/lib/dates";
import { bestPicks } from "@/lib/wishlist";
import { PlanTabs } from "../plan-tabs";
import { WishlistManager, type WishRow } from "./wishlist-manager";

export const metadata = { title: "Wishlist · Pong Money" };

// Installments can run up to a year past a date up to a year away; the
// verdict looks at most 400 days ahead.
const HORIZON_DAYS = 420;

/** Plan › Wishlist: plans you're thinking about, and when and how Pong would do each. */
export default function WishlistPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Plan</h1>
      <PlanTabs current="wishlist" />
      <Suspense fallback={<WishlistSkeleton />}>
        <Wishlist />
      </Suspense>
    </div>
  );
}

async function Wishlist() {
  // Read the clock only at request time (Cache Components).
  await connection();
  const today = getToday();
  const [wishes, plan, custom, planned] = await Promise.all([
    getWishlist(),
    getPlanInputs(today, HORIZON_DAYS),
    getUserCategories(),
    getPlannedExpenses(today),
  ]);
  if (wishes === "missing") {
    return (
      <p className="rounded-[20px] bg-card p-5 text-muted">
        To use your wishlist, run step 29 in <code>supabase/SQL_GUIDE.md</code> first.
      </p>
    );
  }
  const { accounts, inWallets, payday, items } = plan;
  const credit = creditRoom(accounts);
  const cap = credit.length ? await getBnplCap(today, plan) : null;

  // Each idea on its own against your real forecast: never the other ideas.
  const rows: WishRow[] = wishes.map((wish) => {
    // A plan you made real: what's still to come of it in Scheduled.
    const parts = planned.filter((p) => p.wishId === wish.id && !p.transactionId);
    return {
      wish,
      result:
        wish.status === "idea"
          ? bestPicks({ wish, start: inWallets, items, today, payday, credit, cap })
          : null,
      upcoming: parts.length
        ? { count: parts.length, first: parts[0].dueOn, last: parts.at(-1)!.dueOn }
        : null,
    };
  });

  return (
    <WishlistManager
      rows={rows}
      today={today}
      payKnown={Boolean(payday?.amount)}
      hasCredit={credit.length > 0}
      categories={categoriesFor("expense", custom).map((c) => ({ key: c.key, label: c.label }))}
    />
  );
}

function WishlistSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-12 rounded-2xl bg-line-soft" />
      <div className="h-48 rounded-[20px] bg-line-soft" />
      <div className="h-48 rounded-[20px] bg-line-soft" />
    </div>
  );
}

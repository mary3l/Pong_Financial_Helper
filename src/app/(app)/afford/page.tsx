import Link from "next/link";
import { Suspense } from "react";
import { ChevronIcon } from "@/components/icons";
import { Afford, AffordSkeleton } from "./afford";

export const metadata = { title: "Can I afford this? · Pong Money" };

// Opening /afford directly (or reloading it) shows it as a page. Taps on the
// card on Home open the same form as a dialog instead: see @modal/(.)afford.
export default function AffordPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-4xl">
      <Link href="/" className="flex h-11 items-center gap-1 self-start font-bold text-sea-dark">
        <ChevronIcon direction="left" size={20} />
        Home
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">Can I afford this?</h1>
        <p className="text-[15px] text-muted">
          Test a purchase against your forecast before you spend.
        </p>
      </div>
      <Suspense fallback={<AffordSkeleton mode="page" />}>
        <Afford mode="page" />
      </Suspense>
    </div>
  );
}

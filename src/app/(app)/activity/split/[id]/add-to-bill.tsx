"use client";

import { useState, useTransition } from "react";
import { addSplitsToBill } from "@/app/people-actions";
import { formatPeso } from "@/lib/money";

/** A split paid with a credit line that isn't on its bill yet (saved before splits made one). */
export function AddToBill({ splitId, wallet, total }: { splitId: string; wallet: string; total: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <span className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-bold text-muted">Not on your {wallet} bill yet</span>
        <span className="text-sm leading-snug">Add the whole {formatPeso(total)} to the next bill, so it&apos;s in Pay bill and your forecast.</span>
        <span role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addSplitsToBill([splitId]);
            setError(result.error ?? null);
          })
        }
        className="h-11 w-full rounded-[14px] bg-sun px-4 text-sm font-extrabold text-ink disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Adding…" : `Add to ${wallet} bill`}
      </button>
    </>
  );
}

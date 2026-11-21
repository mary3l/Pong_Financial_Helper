"use client";

import { useState, useTransition } from "react";
import { addPurchasesToBill } from "@/app/credit-actions";
import { addSplitsToBill } from "@/app/people-actions";

/** Puts older split bills paid with this credit line on its bills, in one tap. */
export function AddSplitsButton({ splitIds, label }: { splitIds: string[]; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addSplitsToBill(splitIds);
            setError(result.error ?? null);
          })
        }
        className="h-12 rounded-[16px] bg-sun px-4 font-extrabold text-ink disabled:opacity-60"
      >
        {pending ? "Adding…" : label}
      </button>
    </div>
  );
}

/** Puts purchases on this credit line that are on no bill on the bills they land on, in one tap. */
export function AddPurchasesButton({
  lineId,
  ids,
  label,
}: {
  lineId: string;
  ids: string[];
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addPurchasesToBill(lineId, ids);
            setError(result.error ?? null);
          })
        }
        className="h-12 rounded-[16px] bg-sun px-4 font-extrabold text-ink disabled:opacity-60"
      >
        {pending ? "Adding…" : label}
      </button>
    </div>
  );
}

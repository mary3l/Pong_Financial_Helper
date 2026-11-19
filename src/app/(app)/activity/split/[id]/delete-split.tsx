"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSplit } from "@/app/people-actions";

/** Deletes the whole bill: your share and every person's pautang. Tap twice. */
export function DeleteSplit({ splitId, back }: { splitId: string; back: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteSplit(splitId);
      if (result.error) setError(result.error);
      else router.push(back);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">
        {error}
      </p>
      <button
        type="button"
        onClick={remove}
        onBlur={() => setConfirm(false)}
        disabled={pending}
        className={`h-14 rounded-[18px] font-extrabold disabled:opacity-60 ${
          confirm ? "bg-coral text-white" : "bg-card text-coral-text"
        }`}
      >
        {pending
          ? "Deleting…"
          : confirm
            ? "Tap again to delete the whole split"
            : "Delete this split"}
      </button>
    </div>
  );
}

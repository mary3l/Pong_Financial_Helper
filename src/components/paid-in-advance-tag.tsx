import { formatShortDay } from "@/lib/dates";

/** A bill, installment or planned expense you paid before its due date. */
export function PaidInAdvanceTag({ paidOn, today }: { paidOn: string; today: string }) {
  return (
    <span
      title={`Paid ${formatShortDay(paidOn, today)}, before it was due`}
      className="shrink-0 rounded-full bg-sea-tint px-2 text-xs font-extrabold whitespace-nowrap text-sea-dark"
    >
      Paid in advance
    </span>
  );
}

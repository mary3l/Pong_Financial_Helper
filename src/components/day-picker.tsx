"use client";

import { useState } from "react";
import { FIELD_CLASS } from "@/components/choice-chip";
import { ordinal } from "@/components/payday-picker";

/**
 * A day of the month (1–31) as a button that opens a small month grid,
 * instead of a 31-line dropdown. "" is "Not sure" when `unsure` is given.
 */
export function DayPicker({
  id,
  label,
  value,
  onChange,
  unsure,
}: {
  id: string;
  label: React.ReactNode;
  /** "1"–"31", or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** The text for no day ("Not sure"); without it a day must be picked. */
  unsure?: string;
}) {
  const [open, setOpen] = useState(false);
  const day = value ? Number(value) : null;
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-sm font-bold">
        {label}
      </span>
      <button
        id={id}
        type="button"
        aria-labelledby={`${id}-label ${id}`}
        aria-expanded={open}
        aria-controls={`${id}-days`}
        onClick={() => setOpen((o) => !o)}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span className={day ? "" : "text-muted"}>
          {day ? `Every ${ordinal(day)}` : (unsure ?? "Pick a day")}
        </span>
        <span aria-hidden="true" className="text-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div
          id={`${id}-days`}
          role="group"
          aria-labelledby={`${id}-label`}
          className="flex flex-col gap-2 rounded-2xl bg-card p-2 ring-1 ring-line"
        >
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === day}
                aria-label={`Every ${ordinal(d)}`}
                onClick={() => pick(String(d))}
                className={`h-10 rounded-xl text-sm font-extrabold ${
                  d === day ? "bg-sea text-white" : "text-ink hover:bg-mint"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          {unsure && (
            <button
              type="button"
              aria-pressed={day === null}
              onClick={() => pick("")}
              className={`h-10 rounded-xl text-sm font-extrabold ${
                day === null ? "bg-sea text-white" : "bg-mint text-ink"
              }`}
            >
              {unsure}
            </button>
          )}
          {day !== null && day > 28 && (
            <p className="px-1 text-xs text-muted">Shorter months use their last day.</p>
          )}
        </div>
      )}
    </div>
  );
}

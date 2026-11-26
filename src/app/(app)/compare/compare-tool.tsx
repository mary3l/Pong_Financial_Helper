"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FIELD_CLASS } from "@/components/choice-chip";
import { ChevronIcon, CloseIcon } from "@/components/icons";
import { loadTrip, saveTrip, type ActiveTrip } from "@/lib/active-trip";
import { addToCart } from "@/lib/grocery";
import { formatPeso } from "@/lib/money";
import {
  UNIT_GROUPS,
  cartLine,
  compareRows,
  rowLabel,
  type CompareRow,
  type Unit,
} from "@/lib/unit-price";

type Row = CompareRow & { id: number };

let nextId = 0;
const blankRow = (unit: Unit = "ml"): Row => ({
  id: nextId++,
  name: "",
  size: "",
  unit,
  count: "1",
  price: "",
});

// Compare prices: a quick calculator, nothing is saved. During a grocery
// trip, a product can be added to the cart.
export function CompareTool() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => [blankRow(), blankRow()]);
  const [trip, setTrip] = useState<ActiveTrip | null>(null);

  useEffect(() => {
    loadTrip().then((saved) => setTrip(saved?.step === "scan" ? saved : null));
  }, []);

  const results = compareRows(rows);

  function change(id: number, patch: Partial<CompareRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function addToTrip(row: Row, index: number) {
    const line = cartLine(row, index);
    if (!trip || !line) return;
    await saveTrip({ ...trip, items: addToCart(trip.items, line, crypto.randomUUID()) });
    router.push("/grocery");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-11 items-center justify-between">
        <Link
          href={trip ? "/grocery" : "/settings"}
          className="flex items-center gap-1 font-bold text-sea-dark"
        >
          <ChevronIcon direction="left" size={20} />
          {trip ? "Grocery" : "Settings"}
        </Link>
        <button
          type="button"
          onClick={() => setRows([blankRow(), blankRow()])}
          className="h-10 rounded-full px-3 font-extrabold text-sea-dark"
        >
          Clear
        </button>
      </div>
      <h1 className="font-display text-3xl font-semibold">Compare prices</h1>

      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const result = results[i];
          const label = rowLabel(row, i);
          return (
            <li
              key={row.id}
              aria-label={label}
              className={`flex flex-col gap-2 rounded-[20px] bg-card p-4 ${
                result.status === "ok" && result.best ? "ring-2 ring-sun" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Name of ${label}`}
                  placeholder={`Product ${i + 1}`}
                  value={row.name}
                  onChange={(e) => change(row.id, { name: e.target.value })}
                  maxLength={50}
                  className={`${FIELD_CLASS} flex-1 font-bold`}
                />
                {result.status === "ok" && result.best && (
                  <span className="shrink-0 rounded-full bg-sun px-2.5 py-1 text-xs font-extrabold text-ink">
                    ★ Best deal
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
                  aria-label={`Remove ${label}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-mint"
                >
                  <CloseIcon size={18} />
                </button>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_4.5rem] items-center gap-2">
                <input
                  aria-label={`Size of ${label}`}
                  placeholder="Size"
                  inputMode="decimal"
                  value={row.size}
                  onChange={(e) => change(row.id, { size: e.target.value })}
                  className={FIELD_CLASS}
                />
                <select
                  aria-label={`Unit of ${label}`}
                  value={row.unit}
                  onChange={(e) => change(row.id, { unit: e.target.value as Unit })}
                  className={`${FIELD_CLASS} px-2 font-bold`}
                >
                  {UNIT_GROUPS.map((g) => (
                    <optgroup key={g.kind} label={g.kind}>
                      {g.units.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="font-extrabold text-muted">×</span>
                <input
                  aria-label={`Packs in the deal for ${label}`}
                  inputMode="numeric"
                  value={row.count}
                  onChange={(e) => change(row.id, { count: e.target.value })}
                  className={`${FIELD_CLASS} px-3 text-center`}
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="font-extrabold">₱</span>
                <input
                  aria-label={`Price of ${label}`}
                  placeholder="Price"
                  inputMode="decimal"
                  value={row.price}
                  onChange={(e) => change(row.id, { price: e.target.value })}
                  className={`${FIELD_CLASS} flex-1`}
                />
              </div>

              {result.status === "ok" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-lg font-semibold">
                    {formatPeso(result.perDisplay)} / {result.displayLabel}
                  </span>
                  {result.pctMore > 0 && (
                    <span className="text-sm font-extrabold text-coral">+{result.pctMore}%</span>
                  )}
                </div>
              )}
              {result.status === "incomparable" && (
                <p className="text-sm font-bold text-coral">{result.message}</p>
              )}

              {trip && result.status === "ok" && (
                <button
                  type="button"
                  onClick={() => addToTrip(row, i)}
                  className={`h-11 self-end rounded-[16px] px-4 font-extrabold ${
                    result.best ? "bg-sun text-ink" : "bg-mint text-ink"
                  }`}
                >
                  Add to cart
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, blankRow(rs.at(-1)?.unit)])}
        className="h-[52px] rounded-[18px] bg-card font-extrabold text-sea-dark"
      >
        + Add product
      </button>
    </div>
  );
}

import { parseAmount } from "@/lib/money";

// Compare prices: turns "500 ml, ₱599 for 2" into a price per unit so
// products with different sizes and deals can be ranked. Pure, no UI.

export type UnitKind = "volume" | "weight" | "count" | "length";

/** Each unit's kind and how many base units (ml, g, piece, cm) one of it holds. */
export const UNITS = {
  ml: { kind: "volume", factor: 1 },
  L: { kind: "volume", factor: 1000 },
  "fl oz": { kind: "volume", factor: 29.5735 },
  gal: { kind: "volume", factor: 3785.41 },
  mg: { kind: "weight", factor: 0.001 },
  g: { kind: "weight", factor: 1 },
  kg: { kind: "weight", factor: 1000 },
  oz: { kind: "weight", factor: 28.3495 },
  lb: { kind: "weight", factor: 453.592 },
  pcs: { kind: "count", factor: 1 },
  dozen: { kind: "count", factor: 12 },
  cm: { kind: "length", factor: 1 },
  m: { kind: "length", factor: 100 },
} as const satisfies Record<string, { kind: UnitKind; factor: number }>;

export type Unit = keyof typeof UNITS;

export const UNIT_GROUPS: { kind: UnitKind; units: Unit[] }[] = [
  { kind: "volume", units: ["ml", "L", "fl oz", "gal"] },
  { kind: "weight", units: ["mg", "g", "kg", "oz", "lb"] },
  { kind: "count", units: ["pcs", "dozen"] },
  { kind: "length", units: ["cm", "m"] },
];

/** What the price is shown per, in base units: per 100 ml, per 100 g, per piece, per m. */
export const DISPLAY_BASE: Record<UnitKind, { amount: number; label: string }> = {
  volume: { amount: 100, label: "100 ml" },
  weight: { amount: 100, label: "100 g" },
  count: { amount: 1, label: "pc" },
  length: { amount: 100, label: "m" },
};

/** One product as typed: the fields stay text so half-typed values are fine. */
export type CompareRow = {
  name: string;
  size: string;
  unit: Unit;
  count: string;
  price: string;
};

export type RowResult =
  | { status: "blank" }
  | { status: "incomparable"; message: string }
  | {
      status: "ok";
      kind: UnitKind;
      /** Price per base unit (per ml, g, piece or cm), full precision. */
      perBase: number;
      /** Price per DISPLAY_BASE of its kind. */
      perDisplay: number;
      displayLabel: string;
      best: boolean;
      /** How much more per unit than the best, in percent (0 for the best). */
      pctMore: number;
    };

function positive(text: string): number {
  const n = Number(text.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && text.trim() !== "" ? n : NaN;
}

/** The deal's count: a whole number, 1 when left blank. */
function dealCount(text: string): number {
  if (text.trim() === "") return 1;
  const n = positive(text);
  return Number.isInteger(n) ? n : NaN;
}

/** Price per base unit, or null when a field is missing or not a number. */
export function unitPrice(row: CompareRow): number | null {
  const size = positive(row.size);
  const count = dealCount(row.count);
  const price = parseAmount(row.price);
  if (!(size > 0) || !(count > 0) || !(price > 0)) return null;
  return price / (size * UNITS[row.unit].factor * count);
}

// Prices this close (a thousandth of a percent) count as a tie.
const TIE = 1e-5;

/** Ranks the rows: the cheapest per unit is best; rows of another kind are left out. */
export function compareRows(rows: CompareRow[]): RowResult[] {
  const prices = rows.map(unitPrice);
  const first = rows.find((_, i) => prices[i] !== null);
  const kind = first ? UNITS[first.unit].kind : null;
  const ranked = prices.filter(
    (p, i): p is number => p !== null && UNITS[rows[i].unit].kind === kind,
  );
  const lowest = Math.min(...ranked);
  const showBest = ranked.length >= 2;

  return rows.map((row, i) => {
    const perBase = prices[i];
    if (perBase === null) return { status: "blank" };
    const rowKind = UNITS[row.unit].kind;
    if (rowKind !== kind) {
      return {
        status: "incomparable",
        message: `Can't compare ${row.unit} with ${first!.unit}`,
      };
    }
    const base = DISPLAY_BASE[rowKind];
    const ratio = perBase / lowest - 1;
    const best = showBest && ratio < TIE;
    return {
      status: "ok",
      kind: rowKind,
      perBase,
      perDisplay: perBase * base.amount,
      displayLabel: base.label,
      best,
      pctMore: best || ratio < TIE ? 0 : Math.round(ratio * 1000) / 10,
    };
  });
}

/** The blank-name label: "Product 2". */
export function rowLabel(row: CompareRow, index: number): string {
  return row.name.trim() || `Product ${index + 1}`;
}

/** The grocery cart line for a chosen product: "Lotion A 500 ml ×2" at the deal price. */
export function cartLine(
  row: CompareRow,
  index: number,
): { name: string; price: number; barcode: null } | null {
  if (unitPrice(row) === null) return null;
  const count = dealCount(row.count);
  const size = positive(row.size);
  const name = `${rowLabel(row, index)} ${size} ${row.unit}${count > 1 ? ` ×${count}` : ""}`;
  return { name, price: parseAmount(row.price), barcode: null };
}

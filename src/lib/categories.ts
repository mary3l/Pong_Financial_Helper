import type { TransactionType } from "@/lib/money";

// Categories are stored by key so labels and icons can change freely.
// `icon` is a 24×24 stroke path; `tint` is the background class behind it.

export type Category = {
  key: string;
  label: string;
  icon: string;
  tint: string;
};

export const EXPENSE_CATEGORIES: Category[] = [
  {
    key: "food",
    label: "Food",
    tint: "bg-sun-tint",
    icon: "M3 11h18a9 9 0 0 1-18 0zM8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4",
  },
  {
    key: "groceries",
    label: "Groceries",
    tint: "bg-sea-tint",
    icon: "M2 3h3l2.5 12h11L21 7H6M9 20h.01M18 20h.01",
  },
  {
    key: "transport",
    label: "Transpo",
    tint: "bg-sky-tint",
    icon: "M6 3h12a2 2 0 0 1 2 2v10H4V5a2 2 0 0 1 2-2zM4 10h16M8 21l1-4M16 21l-1-4",
  },
  { key: "bills", label: "Bills", tint: "bg-coral-tint", icon: "M13 2 4 14h7l-1 8 9-12h-7z" },
  {
    key: "load",
    label: "Load",
    tint: "bg-plum-tint",
    icon: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  },
  {
    key: "shopping",
    label: "Shopping",
    tint: "bg-sun-tint",
    icon: "M6 8h12l-1 13H7zM9 8V6a3 3 0 0 1 6 0v2",
  },
  {
    key: "health",
    label: "Health",
    tint: "bg-coral-tint",
    icon: "M12 20s-7-4.4-9.2-8.7A4.8 4.8 0 0 1 12 6.3a4.8 4.8 0 0 1 9.2 5C19 15.6 12 20 12 20z",
  },
  {
    key: "family",
    label: "Family",
    tint: "bg-sky-tint",
    icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5",
  },
  {
    key: "fun",
    label: "Fun",
    tint: "bg-plum-tint",
    icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  },
  // Forgiven pautang ends up here.
  {
    key: "gifts",
    label: "Gifts",
    tint: "bg-coral-tint",
    icon: "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z",
  },
  // BNPL fees and loan interest: the only part of an installment that's spending.
  {
    key: "fees",
    label: "Fees & interest",
    tint: "bg-coral-tint",
    icon: "M19 5 5 19M7 7h.01M17 17h.01M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  },
  // SSS, PhilHealth, Pag-IBIG and BIR: what the payroll calculator schedules.
  {
    key: "gov",
    label: "Gov't & tax",
    tint: "bg-sky-tint",
    icon: "M3 10 12 4l9 6M5 10v9M19 10v9M9.5 10v9M14.5 10v9M3 21h18",
  },
  { key: "other", label: "Other", tint: "bg-line-soft", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

export const INCOME_CATEGORIES: Category[] = [
  {
    key: "salary",
    label: "Salary",
    tint: "bg-sea-tint",
    icon: "M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18",
  },
  {
    key: "side_income",
    label: "Side income",
    tint: "bg-sun-tint",
    icon: "M8 21V3h5a5 5 0 0 1 0 10H8M5 7h14M5 10h14",
  },
  {
    key: "gift",
    label: "Gift",
    tint: "bg-coral-tint",
    icon: "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z",
  },
  {
    key: "refund",
    label: "Refund",
    tint: "bg-sky-tint",
    icon: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  },
  // Daily interest from MariBank, GoTyme and other digital banks.
  {
    key: "interest",
    label: "Interest",
    tint: "bg-mint",
    icon: "M12 21v-9M12 12C12 8 9 5 4 5c0 4 3 7 8 7zM12 12c0-3 2.5-6 8-6 0 3.5-2.5 6-8 6z",
  },
  {
    key: "other_income",
    label: "Other",
    tint: "bg-line-soft",
    icon: "M5 12h.01M12 12h.01M19 12h.01",
  },
];

export const TRANSFER_ICON: Omit<Category, "key" | "label"> = {
  tint: "bg-line-soft",
  icon: "M7 7h13l-4-4M17 17H4l4 4",
};

/**
 * Balance adjustments: an income (up) or expense (down) with this category,
 * made from a wallet's "Adjust balance" so it matches what's really in it.
 * Not in either list, so Add can't pick it, and never counted as spending
 * or income: like a transfer, it only changes the wallet's balance.
 */
export const ADJUSTMENT = "adjustment";

export const ADJUSTMENT_INFO: Category = {
  key: ADJUSTMENT,
  label: "Balance adjustment",
  tint: "bg-line-soft",
  icon: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4",
};

export function isAdjustment(txn: { type: TransactionType; category: string | null }): boolean {
  return txn.type !== "transfer" && txn.category === ADJUSTMENT;
}

// ── Your own categories (migration 0027) ─────────────────────────────────

/** A category you added in Settings › Categories. Its key starts with "u_". */
export type UserCategory = Category & {
  id: string;
  type: "expense" | "income";
  /** Not offered for new entries; old ones still show it. */
  hidden: boolean;
};

/** Icons to pick from for your own categories: each a 24×24 stroke path. */
export const CATEGORY_ICONS: readonly { name: string; icon: string }[] = [
  ...[...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]
    .filter((c, i, all) => all.findIndex((x) => x.icon === c.icon) === i)
    .map((c) => ({ name: c.label, icon: c.icon })),
  { name: "Home", icon: "M4 11l8-7 8 7M6 10v10h12V10" },
  {
    name: "Pet",
    icon: "M8 8a2 2 0 1 0 0-.01M16 8a2 2 0 1 0 0-.01M12 20c-3 0-5-2-5-4s2-4 5-4 5 2 5 4-2 4-5 4z",
  },
  { name: "School", icon: "M3 9l9-5 9 5-9 5zM7 11v5c3 2 7 2 10 0v-5" },
  { name: "Car", icon: "M5 16h14M6 16l1.5-5h9L18 16M7 19v-3M17 19v-3" },
  { name: "Coffee", icon: "M5 9h11v5a5 5 0 0 1-10 0zM16 10h2a2 2 0 0 1 0 4h-2M8 4v2M11 4v2" },
  { name: "Baby", icon: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8M8 20c0-2 2-4 4-4s4 2 4 4" },
];

/** Colours to pick from: the tints the built-in categories use (Tailwind keeps these classes). */
export const CATEGORY_TINTS: readonly string[] = [
  "bg-sun-tint",
  "bg-sea-tint",
  "bg-sky-tint",
  "bg-coral-tint",
  "bg-plum-tint",
  "bg-mint",
  "bg-line-soft",
];

export const CUSTOM_PREFIX = "u_";
export const CATEGORY_LABEL_MAX = 30;

/** "u_milk_tea" for "Milk tea": the key a new category of yours is saved under. */
export function categoryKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return `${CUSTOM_PREFIX}${slug || "category"}`;
}

/**
 * Before signing in: a built-in key, or one shaped like yours (u_milk_tea).
 * Whether one of yours really exists is checked against the database after.
 */
export function couldBeCategory(type: TransactionType, key: unknown): boolean {
  return (
    isCategoryFor(type, key) ||
    (type !== "transfer" && typeof key === "string" && /^u_[a-z0-9_]{1,36}$/.test(key))
  );
}

/** Built-in categories, then yours that aren't hidden: what Add and the pickers offer. */
export function categoriesFor(
  type: TransactionType,
  custom: readonly UserCategory[] = [],
): Category[] {
  const builtIn =
    type === "expense" ? EXPENSE_CATEGORIES : type === "income" ? INCOME_CATEGORIES : [];
  if (type === "transfer") return builtIn;
  // Yours go before Other, so Other stays last.
  const mine = custom.filter((c) => c.type === type && !c.hidden);
  return [...builtIn.slice(0, -1), ...mine, builtIn.at(-1)!];
}

/** A key you can save under: built-in, or one of yours (hidden ones too, for old entries). */
export function isCategoryFor(
  type: TransactionType,
  key: unknown,
  custom: readonly UserCategory[] = [],
): boolean {
  return (
    categoriesFor(type).some((c) => c.key === key) ||
    custom.some((c) => c.type === type && c.key === key)
  );
}

export const SUBCATEGORY_MAX = 40;

/**
 * A few common subcategories for each built-in category, offered in Add
 * before you've typed any of your own, so a category isn't one big bucket
 * from day one. Up to 6 each. Other, Other income and your own categories
 * have none.
 *
 * Gov't & tax leaves out SSS, PhilHealth, Pag-IBIG and income tax on
 * purpose: the Pay tab already makes those monthly bills and planned
 * payments (marking them paid logs them), and ones your office takes come
 * off your payday, so they aren't expenses at all. A chip for them would
 * invite logging the same payment twice.
 */
export const STARTER_SUBCATEGORIES: Readonly<Record<string, readonly string[]>> = {
  food: ["Merienda", "Lunch", "Coffee & milk tea", "Fast food", "Food delivery", "Dining out"],
  groceries: ["Supermarket", "Palengke", "Sari-sari store", "Rice", "Water refill"],
  transport: ["Jeep", "Tricycle", "Grab or taxi", "Bus", "MRT/LRT", "Gas"],
  bills: ["Electricity", "Water", "Internet", "Rent", "Postpaid plan", "Association dues"],
  load: ["Prepaid load", "Data promo"],
  shopping: ["Clothes", "Shoes", "Gadgets", "Home items", "Online shopping"],
  health: ["Medicine", "Check-up", "Dental", "Vitamins", "Lab tests", "HMO"],
  family: ["Padala", "Allowance", "Baon", "Tuition", "Household help"],
  fun: ["Movies", "Streaming", "Games", "Hobbies", "Gimik", "Travel"],
  gifts: ["Birthday", "Wedding", "Christmas", "Pasalubong", "Ninong or ninang"],
  fees: ["Bank fees", "Transfer fees", "Late fees", "Interest", "Annual fee"],
  gov: [
    "Passport",
    "NBI & police clearance",
    "Driver's license & LTO",
    "Cedula & barangay",
    "Real property tax",
    "Business permit",
  ],
  salary: ["13th month", "Bonus", "Overtime", "Allowance"],
  side_income: ["Freelance", "Online selling", "Commission", "Tutoring"],
  gift: ["Pamasko", "Birthday"],
  refund: ["Cashback", "Returned item"],
  interest: ["Savings", "Time deposit"],
};

/**
 * The subcategories to offer in `category`: the ones you've used (in the
 * order given, most used first), then its starters you haven't, so
 * "jeep" you typed hides the "Jeep" starter. `starter` marks the ones you
 * haven't used yet.
 */
export function subcategoriesWithStarters(
  category: string,
  used: readonly string[] = [],
): { name: string; starter: boolean }[] {
  const seen = new Set<string>();
  const list: { name: string; starter: boolean }[] = [];
  for (const [names, starter] of [
    [used, false],
    [STARTER_SUBCATEGORIES[category] ?? [], true],
  ] as const) {
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ name, starter });
    }
  }
  return list;
}

/** A typed subcategory with its spaces tidied; null when there's nothing left. */
export function cleanSubcategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * The subcategories used before in each category, most used first (ties:
 * most recent first). `rows` is newest first; "jeep" and "Jeep" are one,
 * spelled the newest way.
 */
export function subcategoryOptions(
  rows: { category: string | null; subcategory: string | null }[],
): Record<string, string[]> {
  const byCategory = new Map<string, Map<string, { name: string; count: number; order: number }>>();
  rows.forEach((r, order) => {
    const name = cleanSubcategory(r.subcategory);
    if (!r.category || !name) return;
    const seen = byCategory.get(r.category) ?? new Map();
    const hit = seen.get(name.toLowerCase());
    if (hit) hit.count += 1;
    else seen.set(name.toLowerCase(), { name, count: 1, order });
    byCategory.set(r.category, seen);
  });
  return Object.fromEntries(
    [...byCategory].map(([category, seen]) => [
      category,
      [...seen.values()].sort((a, b) => b.count - a.count || a.order - b.order).map((s) => s.name),
    ]),
  );
}

/** "Transpo › Jeep", or just "Transpo". */
export function categoryLabel(
  type: TransactionType,
  key: string | null,
  subcategory?: string | null,
  custom: readonly UserCategory[] = [],
) {
  const label = categoryInfo(type, key, custom).label;
  return subcategory && type !== "transfer" ? `${label} › ${subcategory}` : label;
}

/** Display info for a stored transaction, including yours, old or unknown keys. */
export function categoryInfo(
  type: TransactionType,
  key: string | null,
  custom: readonly UserCategory[] = [],
): Category {
  if (type === "transfer") return { key: "transfer", label: "Transfer", ...TRANSFER_ICON };
  if (key === ADJUSTMENT) return ADJUSTMENT_INFO;
  const found =
    categoriesFor(type).find((c) => c.key === key) ??
    custom.find((c) => c.type === type && c.key === key);
  if (found) return found;
  const fallback = categoriesFor(type).at(-1)!;
  // One of yours where the list wasn't passed: "u_milk_tea" reads "Milk tea".
  const label =
    key?.startsWith(CUSTOM_PREFIX) && key.length > CUSTOM_PREFIX.length
      ? key
          .slice(CUSTOM_PREFIX.length)
          .replace(/_/g, " ")
          .replace(/^./, (c) => c.toUpperCase())
      : (key ?? (type === "income" ? "Income" : "Expense"));
  return { ...fallback, label };
}

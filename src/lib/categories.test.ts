import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT,
  CATEGORY_ICONS,
  categoriesFor,
  categoryInfo,
  categoryKey,
  categoryLabel,
  cleanSubcategory,
  isAdjustment,
  EXPENSE_CATEGORIES,
  STARTER_SUBCATEGORIES,
  SUBCATEGORY_MAX,
  isCategoryFor,
  subcategoriesWithStarters,
  subcategoryOptions,
  type UserCategory,
} from "@/lib/categories";

describe("subcategories", () => {
  it("tidies what you type", () => {
    expect(cleanSubcategory("  Jeep   to  work ")).toBe("Jeep to work");
    expect(cleanSubcategory("   ")).toBeNull();
    expect(cleanSubcategory(null)).toBeNull();
    expect(cleanSubcategory(5)).toBeNull();
  });

  it("offers the ones used before, most used first, newest spelling", () => {
    // Newest first, like the query.
    const rows = [
      { category: "transport", subcategory: "Grab" },
      { category: "transport", subcategory: "jeep" },
      { category: "transport", subcategory: "Jeep" },
      { category: "transport", subcategory: "Tricycle" },
      { category: "food", subcategory: "Merienda" },
      { category: "food", subcategory: null },
      { category: null, subcategory: "Orphan" },
    ];
    expect(subcategoryOptions(rows)).toEqual({
      transport: ["jeep", "Grab", "Tricycle"],
      food: ["Merienda"],
    });
  });

  it("labels a category with its subcategory", () => {
    expect(categoryLabel("expense", "transport", "Jeep")).toBe("Transpo › Jeep");
    expect(categoryLabel("expense", "transport", null)).toBe("Transpo");
    expect(categoryLabel("transfer", null, "Jeep")).toBe("Transfer");
  });
});

describe("balance adjustments", () => {
  it("have their own label and aren't pickable in Add", () => {
    expect(categoryInfo("expense", ADJUSTMENT).label).toBe("Balance adjustment");
    expect(categoryInfo("income", ADJUSTMENT).label).toBe("Balance adjustment");
    expect(isCategoryFor("expense", ADJUSTMENT)).toBe(false);
    expect(isCategoryFor("income", ADJUSTMENT)).toBe(false);
  });

  it("are told apart from transfers and other categories", () => {
    expect(isAdjustment({ type: "income", category: ADJUSTMENT })).toBe(true);
    expect(isAdjustment({ type: "expense", category: "food" })).toBe(false);
    expect(isAdjustment({ type: "transfer", category: ADJUSTMENT })).toBe(false);
  });
});

describe("your own categories", () => {
  const milkTea: UserCategory = {
    id: "c1",
    type: "expense",
    key: "u_milk_tea",
    label: "Milk tea",
    icon: CATEGORY_ICONS[0].icon,
    tint: "bg-plum-tint",
    hidden: false,
  };
  const old: UserCategory = { ...milkTea, id: "c2", key: "u_vape", label: "Vape", hidden: true };
  const custom = [milkTea, old];

  it("makes a key from the name", () => {
    expect(categoryKey("Milk tea")).toBe("u_milk_tea");
    expect(categoryKey("  Pet / Vet!! ")).toBe("u_pet_vet");
    expect(categoryKey("***")).toBe("u_category");
  });

  it("offers yours before Other, leaving hidden ones out", () => {
    const keys = categoriesFor("expense", custom).map((c) => c.key);
    expect(keys.at(-1)).toBe("other");
    expect(keys.at(-2)).toBe("u_milk_tea");
    expect(keys).not.toContain("u_vape");
    expect(categoriesFor("income", custom).map((c) => c.key)).not.toContain("u_milk_tea");
  });

  it("accepts yours, hidden ones too, but only for their own type", () => {
    expect(isCategoryFor("expense", "u_milk_tea", custom)).toBe(true);
    expect(isCategoryFor("expense", "u_vape", custom)).toBe(true);
    expect(isCategoryFor("income", "u_milk_tea", custom)).toBe(false);
    expect(isCategoryFor("expense", "u_milk_tea")).toBe(false);
  });

  it("shows yours with its name, icon and colour", () => {
    expect(categoryInfo("expense", "u_milk_tea", custom)).toMatchObject({
      label: "Milk tea",
      tint: "bg-plum-tint",
    });
    expect(categoryLabel("expense", "u_vape", "Pods", custom)).toBe("Vape › Pods");
  });

  it("still reads a key of yours where the list wasn't passed", () => {
    expect(categoryInfo("expense", "u_milk_tea").label).toBe("Milk tea");
  });
});

describe("starter subcategories", () => {
  it("gives every built-in expense category but Other a few, short and distinct", () => {
    for (const c of EXPENSE_CATEGORIES) {
      const starters = STARTER_SUBCATEGORIES[c.key] ?? [];
      if (c.key === "other") {
        expect(starters).toEqual([]);
        continue;
      }
      expect(starters.length, c.key).toBeGreaterThan(0);
      expect(starters.length, c.key).toBeLessThanOrEqual(6);
      expect(new Set(starters.map((s) => s.toLowerCase())).size, c.key).toBe(starters.length);
      for (const s of starters)
        expect(cleanSubcategory(s)?.length).toBeLessThanOrEqual(SUBCATEGORY_MAX);
    }
  });

  it("leaves out what the Pay tab already logs, so it isn't logged twice", () => {
    const gov = STARTER_SUBCATEGORIES.gov.map((s) => s.toLowerCase());
    for (const paid of ["sss", "philhealth", "pag-ibig", "tax", "income tax"]) {
      expect(gov).not.toContain(paid);
    }
  });

  it("offers yours first, then starters you haven't used, ignoring case", () => {
    expect(subcategoriesWithStarters("transport", ["Angkas", "jeep"])).toEqual([
      { name: "Angkas", starter: false },
      { name: "jeep", starter: false },
      { name: "Tricycle", starter: true },
      { name: "Grab or taxi", starter: true },
      { name: "Bus", starter: true },
      { name: "MRT/LRT", starter: true },
      { name: "Gas", starter: true },
    ]);
  });

  it("has none for your own categories", () => {
    expect(subcategoriesWithStarters("u_milk_tea", ["Okinawa"])).toEqual([
      { name: "Okinawa", starter: false },
    ]);
    expect(subcategoriesWithStarters("u_milk_tea")).toEqual([]);
  });
});

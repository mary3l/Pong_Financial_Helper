import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT,
  categoryInfo,
  categoryLabel,
  cleanSubcategory,
  isAdjustment,
  isCategoryFor,
  subcategoryOptions,
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

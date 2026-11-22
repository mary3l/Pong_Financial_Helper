import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { CATEGORY_ICONS } from "@/lib/categories";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  addCategory,
  setCategoryHidden,
  updateCategory,
  type CategoryInput,
} from "./category-actions";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: FakeSupabase;
function useDb(
  seed?: Parameters<typeof fakeSupabase>[0],
  opts?: Parameters<typeof fakeSupabase>[1],
) {
  db = fakeSupabase(seed, opts);
  vi.mocked(createClient).mockResolvedValue(db.client);
  return db;
}

const milkTea: CategoryInput = {
  type: "expense",
  label: "  Milk   tea ",
  icon: CATEGORY_ICONS[0].icon,
  tint: "bg-plum-tint",
};

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("addCategory", () => {
  it.each<[string, Partial<CategoryInput>, string]>([
    ["no name", { label: "  " }, "Give it a name, like Milk tea."],
    ["long name", { label: "x".repeat(31) }, "Keep the name to 30 characters."],
    ["a built-in name", { label: "food" }, "food is already a category."],
    ["an unknown icon", { icon: "M0 0" }, "Pick an icon."],
    ["an unknown colour", { tint: "bg-[red]" }, "Pick a colour."],
    ["a bad type", { type: "transfer" as never }, "Pick Expense or Income."],
  ])("rejects %s without touching the database", async (_, patch, error) => {
    expect(await addCategory({ ...milkTea, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves it under a key made from the name", async () => {
    expect(await addCategory(milkTea)).toEqual({ key: "u_milk_tea" });
    expect(db.table("user_categories")).toEqual([
      expect.objectContaining({
        type: "expense",
        key: "u_milk_tea",
        label: "Milk tea",
        tint: "bg-plum-tint",
      }),
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("makes the key unique, and refuses the same name twice", async () => {
    useDb({
      user_categories: [{ id: "c1", type: "income", key: "u_milk_tea", label: "Milk tea" }],
    });
    // Same name for income is taken; for expenses it gets its own key.
    expect(await addCategory({ ...milkTea, type: "income" })).toEqual({
      error: "Milk tea is already a category.",
    });
    expect(await addCategory(milkTea)).toEqual({ key: "u_milk_tea_2" });
  });

  it("needs a session, and asks for step 27 before the table is there", async () => {
    useDb({}, { user: null });
    expect(await addCategory(milkTea)).toEqual({ error: SIGNED_OUT_ERROR });
    useDb();
    db.respond((q) => (q.table === "user_categories" ? fail("PGRST205", "no table") : undefined));
    expect(await addCategory(milkTea)).toEqual({
      error: "To add your own categories, run step 27 in supabase/SQL_GUIDE.md first.",
    });
  });
});

describe("updateCategory and setCategoryHidden", () => {
  beforeEach(() => {
    useDb({
      user_categories: [
        { id: "c1", type: "expense", key: "u_milk_tea", label: "Milk tea", hidden: false },
      ],
    });
  });

  it("renames it and keeps its key, so entries follow", async () => {
    expect(await updateCategory("c1", { ...milkTea, label: "Boba", tint: "bg-sky-tint" })).toEqual(
      {},
    );
    expect(db.table("user_categories")[0]).toMatchObject({
      key: "u_milk_tea",
      label: "Boba",
      tint: "bg-sky-tint",
    });
    expect(await updateCategory("nope", milkTea)).toEqual({
      error: "Couldn't find that category.",
    });
  });

  it("hides it and brings it back", async () => {
    expect(await setCategoryHidden("c1", true)).toEqual({});
    expect(db.table("user_categories")[0].hidden).toBe(true);
    expect(await setCategoryHidden("c1", false)).toEqual({});
    expect(db.table("user_categories")[0].hidden).toBe(false);
  });
});

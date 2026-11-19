import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import { setDisplayName, signOut } from "./actions";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: FakeSupabase;
beforeEach(() => {
  vi.clearAllMocks();
  db = fakeSupabase();
  vi.mocked(createClient).mockResolvedValue(db.client);
});

const form = (name: string) => {
  const f = new FormData();
  f.set("display_name", name);
  return f;
};

describe("signOut", () => {
  it("signs out and goes to the login page", async () => {
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
    expect(db.auth.signOut).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

describe("setDisplayName", () => {
  it("rejects a blank name", async () => {
    expect(await setDisplayName({}, form("   "))).toEqual({
      error: "Type the name you'd like Pong to use.",
    });
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a long name", async () => {
    expect((await setDisplayName({}, form("x".repeat(200)))).error).toMatch(/characters or fewer/);
  });

  it("saves the tidied name and refreshes the session", async () => {
    expect(await setDisplayName({}, form("  Mia   Santos "))).toEqual({ saved: true });
    expect(db.auth.updateUser).toHaveBeenCalledWith({ data: { display_name: "Mia Santos" } });
    expect(db.auth.refreshSession).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("reports a failed save", async () => {
    db.auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: "x" } });
    expect(await setDisplayName({}, form("Mia"))).toEqual({
      error: "Couldn't save your name. Please try again.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

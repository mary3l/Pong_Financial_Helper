import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import { createWidgetKey, turnOffWidget } from "./widget-actions";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "pong.example", "x-forwarded-proto": "https" })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: FakeSupabase;
function useDb(opts?: Parameters<typeof fakeSupabase>[1]) {
  db = fakeSupabase({}, opts);
  vi.mocked(createClient).mockResolvedValue(db.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("createWidgetKey", () => {
  it("needs a session", async () => {
    useDb({ user: null });
    expect(await createWidgetKey()).toEqual({ error: SIGNED_OUT_ERROR });
  });

  it("stores only the key's hash and returns a setup code with the key", async () => {
    const { setupCode, error } = await createWidgetKey();
    expect(error).toBeUndefined();
    const setup = JSON.parse(Buffer.from(setupCode!, "base64url").toString());
    expect(setup.app).toBe("https://pong.example");

    const upsert = db.queries.find((q) => q.op === "upsert")!;
    expect(upsert.options).toEqual({ onConflict: "user_id" });
    const row = upsert.payload as Record<string, string>;
    expect(row.user_id).toBe("user-1");
    expect(row.key_hash).toBe(createHash("sha256").update(setup.widget).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(setup.widget);
  });

  it("points to the migration when the table is missing", async () => {
    db.respond(() => fail("PGRST205", "no table"));
    expect((await createWidgetKey()).error).toMatch(/run step 9/i);
  });
});

describe("turnOffWidget", () => {
  it("deletes this user's key only", async () => {
    expect(await turnOffWidget()).toEqual({});
    const del = db.queries.find((q) => q.op === "delete")!;
    expect(del.table).toBe("widget_keys");
    expect(del.filters).toEqual([{ method: "eq", args: ["user_id", "user-1"] }]);
  });
});

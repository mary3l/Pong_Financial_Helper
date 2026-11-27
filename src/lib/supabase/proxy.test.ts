import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const claims = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: claims.value ? { claims: claims.value } : null }) },
  }),
}));

const { updateSession } = await import("./proxy");

function visit(path: string) {
  return updateSession(new NextRequest(new URL(path, "https://pong.example")));
}

afterEach(() => {
  claims.value = null;
});

describe("proxy routing", () => {
  it("shows the public home page at / when signed out", async () => {
    const res = await visit("/");
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://pong.example/welcome");
    expect(res.headers.get("location")).toBeNull();
  });

  it("keeps / as the dashboard when signed in", async () => {
    claims.value = { sub: "u1", user_metadata: { setup_done: true } };
    const res = await visit("/");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends /welcome to / so the page has one address", async () => {
    const res = await visit("/welcome");
    expect(res.headers.get("location")).toBe("https://pong.example/");
  });

  it("still sends signed-out visitors of private pages to /login", async () => {
    const res = await visit("/plan");
    expect(res.headers.get("location")).toBe("https://pong.example/login");
  });
});

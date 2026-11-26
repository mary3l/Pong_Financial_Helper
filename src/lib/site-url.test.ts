import { describe, expect, it } from "vitest";
import { siteUrl } from "./site-url";

describe("site url", () => {
  it("uses NEXT_PUBLIC_SITE_URL first", () => {
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://pong.example ",
        VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app",
      }).origin,
    ).toBe("https://pong.example");
  });

  it("falls back to the Vercel production domain, then localhost", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "pong.vercel.app" }).origin).toBe(
      "https://pong.vercel.app",
    );
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: " " }).origin).toBe("http://localhost:3000");
  });
});

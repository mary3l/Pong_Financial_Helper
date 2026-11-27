import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

afterEach(() => vi.unstubAllEnvs());

describe("seo files", () => {
  it("lets crawlers see only the public pages", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pong.example");
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: ["/$", "/login", "/opengraph-image"], disallow: "/" },
      sitemap: "https://pong.example/sitemap.xml",
    });
    expect(sitemap()).toEqual([
      { url: "https://pong.example/", changeFrequency: "monthly", priority: 1 },
      { url: "https://pong.example/login", changeFrequency: "monthly", priority: 0.5 },
    ]);
  });
});

import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/site-url";

// Only the public pages may be crawled. Everything else is someone's own
// money and needs a sign-in anyway. `/$` allows the home page alone: a bare
// `/` would match every path.
export default function robots(): MetadataRoute.Robots {
  const allow = PUBLIC_PAGES.map((path) => (path === "/" ? "/$" : path));
  return {
    rules: { userAgent: "*", allow: [...allow, "/opengraph-image"], disallow: "/" },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}

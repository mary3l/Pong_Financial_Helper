import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/site-url";

// Only the public pages may be crawled. Everything else is someone's own
// money and needs a sign-in anyway.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: [...PUBLIC_PAGES, "/opengraph-image"], disallow: "/" },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}

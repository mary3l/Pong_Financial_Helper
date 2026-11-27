// The app's public address, for links in search results and share cards.
// Set NEXT_PUBLIC_SITE_URL to the live address; on Vercel the production
// domain is used when it isn't set.
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return new URL(explicit);
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}

/** Pages anyone can open signed out, and that search engines may list. */
export const PUBLIC_PAGES = ["/", "/login"];

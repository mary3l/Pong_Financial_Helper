import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

// Refreshes the Supabase session cookie and sends signed-out visitors to /login.
// Signed out, `/` shows the public home page (app/welcome) at the same address.
// This is an optimistic check only: data access is protected by RLS in Postgres.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Don't put code between createServerClient and getClaims: it refreshes the
  // session and a mistake here signs users out at random.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // The public home page lives at `/` only, so search engines see one address.
  if (pathname === "/welcome") {
    return redirectKeepingCookies(request, response, "/");
  }
  if (!signedIn && pathname === "/") {
    return rewriteKeepingCookies(request, response, "/welcome");
  }
  if (!signedIn && !isPublic) {
    return redirectKeepingCookies(request, response, "/login");
  }
  if (signedIn && pathname === "/login") {
    return redirectKeepingCookies(request, response, "/");
  }
  // First run: Home sends new users through wallet and payday setup once.
  // Finishing or skipping it sets `setup_done` (see app/setup-actions.ts).
  if (signedIn && pathname === "/" && !data?.claims.user_metadata?.setup_done) {
    return redirectKeepingCookies(request, response, "/setup");
  }

  return response;
}

function rewriteKeepingCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const rewrite = NextResponse.rewrite(url, { request });
  from.cookies.getAll().forEach((cookie) => rewrite.cookies.set(cookie));
  return rewrite;
}

function redirectKeepingCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

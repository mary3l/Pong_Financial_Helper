import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type User = {
  id: string;
  email: string;
  /** What Pong calls the user. Null until they choose one. */
  name: string | null;
};

// Reads the session at request time, so callers must sit behind <Suspense>.
// Once per request: the nav's avatar and Home's header share it.
export const getCurrentUser = cache(async (): Promise<User> => {
  // Supabase checks token expiry with Date.now(), so opt out of prerendering
  // explicitly; otherwise Cache Components flags it during validation.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) {
    redirect("/login");
  }

  // Only the name the user picked; never guessed from the email.
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    typeof meta.display_name === "string" && meta.display_name.trim()
      ? meta.display_name.trim()
      : null;

  return { id: claims.sub, email: claims.email ?? "", name };
});

/** For Server Actions: a Supabase client for the signed-in user, or null. */
export async function signedInClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ? supabase : null;
}

export const SIGNED_OUT_ERROR = "You've been signed out. Sign in again to continue.";

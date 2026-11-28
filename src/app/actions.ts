"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { DISPLAY_NAME_MAX } from "@/lib/display-name";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type DisplayNameState = { error?: string; saved?: boolean };

export async function setDisplayName(
  _prev: DisplayNameState,
  formData: FormData,
): Promise<DisplayNameState> {
  const name = String(formData.get("display_name") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) {
    return { error: "Type the name you'd like Pong to use." };
  }
  if (name.length > DISPLAY_NAME_MAX) {
    return { error: `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { display_name: name },
  });
  if (error) {
    return { error: "Couldn't save your name. Please try again." };
  }

  // The session token carries user metadata, so refresh it to pick up the
  // new name right away instead of at the next token refresh.
  await supabase.auth.refreshSession();
  refresh();
  return { saved: true };
}

/**
 * Refreshes every screen after a save that skipped it, so a form can close
 * first and let Home catch up behind it.
 */
export async function refreshApp() {
  refresh();
}

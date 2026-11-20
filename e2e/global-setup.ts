import { createClient } from "@supabase/supabase-js";
import type { FullConfig } from "@playwright/test";

// Before any test: a fresh test user per browser, already past first-run setup,
// with one Cash wallet holding ₱1,000. Uses the LOCAL Supabase's secret key
// (from .env.e2e), so it bypasses RLS to set things up.
export const STARTING_CASH = 1000;

export default async function globalSetup(config: FullConfig) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const emails = [
    ...new Set(config.projects.map((p) => p.metadata.email as string).filter(Boolean)),
  ];

  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  for (const email of emails) {
    // Start clean: deleting the user deletes their rows too (on delete cascade).
    const old = list.users.find((u) => u.email === email);
    if (old) {
      const { error } = await admin.auth.admin.deleteUser(old.id);
      if (error) throw error;
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { setup_done: true, display_name: "Tester" },
    });
    if (error) throw error;

    const wallet = await admin.from("accounts").insert({
      user_id: data.user.id,
      name: "Cash",
      type: "cash",
      starting_balance: STARTING_CASH,
    });
    if (wallet.error) throw wallet.error;
  }

  // An empty test inbox, so each sign-in reads its own email.
  await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

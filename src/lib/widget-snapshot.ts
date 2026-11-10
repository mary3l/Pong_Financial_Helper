import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SafeToSpend } from "@/lib/forecast";

/**
 * Saves today's Safe to spend on your widget key, for the home screen widget
 * (see 0020_widget_safe_to_spend.sql). Does nothing without a widget key, and
 * never breaks Home: before step 20 is run the columns are missing, and any
 * error is ignored.
 */
export async function saveWidgetSnapshot(sts: SafeToSpend, today: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims.sub;
    if (!userId) return;
    await supabase
      .from("widget_keys")
      .update({
        sts_on: today,
        sts_per_day: sts.perDay,
        sts_next_payday: sts.nextPayday,
      })
      .eq("user_id", userId);
  } catch {
    // The widget keeps its last number.
  }
}

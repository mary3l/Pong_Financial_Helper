import Link from "next/link";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/theme";
import { getCurrentUser } from "@/lib/auth";

// The dark mode toggle and the Settings avatar, top right of every signed-in
// page (from the (app) layout).
export function TopActions() {
  return (
    <div className="mb-3 flex items-center justify-end gap-2">
      <ThemeToggle />
      <Suspense fallback={<SettingsLink initial={null} />}>
        <UserSettingsLink />
      </Suspense>
    </div>
  );
}

async function UserSettingsLink() {
  const user = await getCurrentUser();
  return <SettingsLink initial={user.name ? user.name.charAt(0).toUpperCase() : null} />;
}

function SettingsLink({ initial }: { initial: string | null }) {
  return (
    <Link
      href="/settings"
      aria-label="Settings and tools"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sun font-display text-lg font-semibold text-ink"
    >
      {initial ?? <PersonIcon />}
    </Link>
  );
}

function PersonIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

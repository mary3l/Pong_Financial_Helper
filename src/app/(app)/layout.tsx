import { BottomNav, Sidebar } from "@/components/app-nav";
import { OfflineBanner } from "@/components/offline";
import { Toaster } from "@/components/toast";
import { TopActions } from "@/components/top-actions";

// Private screens: never in search results.
export const metadata = { robots: { index: false, follow: false } };

// Signed-in area. The proxy redirects signed-out visitors to /login; data is
// protected separately by row-level security in Supabase. `modal` shows Add
// over the current page (see @modal).
export default function AppLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] gap-6 lg:p-6">
      <Sidebar />
      <main className="min-w-0 flex-1 px-5 pt-5 pb-32 lg:px-0 lg:pt-0 lg:pb-6">
        <TopActions />
        {children}
      </main>
      <BottomNav />
      <OfflineBanner />
      <Toaster />
      {modal}
    </div>
  );
}

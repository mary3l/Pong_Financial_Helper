export const metadata = { robots: { index: false, follow: false } };

// First-run setup (design canvas 1.2 and 1.3): no nav, one column.
export default function SetupLayout({ children }: LayoutProps<"/setup">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-8 pb-10">
      {children}
    </main>
  );
}

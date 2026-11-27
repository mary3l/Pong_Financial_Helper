import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { ServiceWorker } from "@/components/offline";
import { ThemeScript } from "@/components/theme";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Pong is a financial helper app for paydays, bills, utang and groceries in the Philippines.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Pong Money",
  description: DESCRIPTION,
  applicationName: "Pong Money",
  keywords: [
    "financial helper app",
    "budget app Philippines",
    "budget tracker",
    "kinsenas",
    "payday budget",
    "expense tracker",
    "utang tracker",
    "bills tracker",
    "grocery price compare",
  ],
  // Google Search Console's ownership check. Set GOOGLE_SITE_VERIFICATION on
  // Vercel to the code Search Console gives; without it no tag is added.
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  openGraph: {
    type: "website",
    siteName: "Pong Money",
    title: "Pong Money",
    description: DESCRIPTION,
    locale: "en_PH",
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: "Pong Money", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#13795A",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${fredoka.variable} ${nunito.variable} h-full antialiased`}
      // The theme script sets data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}

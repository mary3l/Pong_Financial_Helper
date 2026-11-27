import Link from "next/link";
import { SignInHero } from "@/app/login/hero";
import { siteUrl } from "@/lib/site-url";
import { DESCRIPTION, FAQ, FEATURES, TITLE, jsonLd, structuredData } from "./content";

// The public home page. Signed-out visitors (and search engines) opening `/`
// see this: the proxy rewrites `/` here, so the address stays `/`. Opening
// /welcome directly redirects to `/`, so it lives at one address only.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/" },
};

export default function WelcomePage() {
  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData(siteUrl())) }}
      />
      <SignInHero
        intro={
          <>
            Pong Money is a free budget app for the Philippines. I&apos;ll watch your bills,
            kinsenas paydays and pautang, and tell you how much you can safely spend each day.
          </>
        }
      />

      {/* -mt-px: the hero is one screen tall, which can land on a fraction of a
          pixel and leave a thin green line here. Overlap it by a pixel. */}
      <div className="relative -mt-px bg-card">
        <div className="mx-auto flex w-full max-w-md flex-col gap-10 px-6 pt-4 pb-14">
          <section aria-labelledby="features" className="flex flex-col gap-4">
            <h2 id="features" className="font-display text-2xl font-semibold">
              What Pong does
            </h2>
            <ul className="flex flex-col gap-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-[18px] bg-mint p-4">
                  <h3 className="font-extrabold">{f.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="faq" className="flex flex-col gap-4">
            <h2 id="faq" className="font-display text-2xl font-semibold">
              Questions
            </h2>
            <div className="flex flex-col gap-2">
              {FAQ.map((f) => (
                <details key={f.question} className="group rounded-[18px] border-2 border-line">
                  <summary className="cursor-pointer list-none px-4 py-3 font-bold marker:hidden">
                    <span aria-hidden="true" className="mr-2 inline-block group-open:rotate-90">
                      ▸
                    </span>
                    {f.question}
                  </summary>
                  <p className="px-4 pb-4 text-[15px] leading-relaxed text-muted">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <Link
            href="/login"
            className="flex h-14 items-center justify-center rounded-[18px] bg-sun text-[17px] font-extrabold text-ink"
          >
            Start for free
          </Link>
        </div>
      </div>
    </main>
  );
}

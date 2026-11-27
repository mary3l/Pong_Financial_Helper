import { Suspense } from "react";
import { SignInError, SignInPanel } from "@/app/login/sign-in-panel";
import { Pong } from "@/components/pong";
import { siteUrl } from "@/lib/site-url";
import { DESCRIPTION, FAQ, FEATURES, TITLE, WHY, jsonLd, structuredData } from "./content";
import { InstallButton } from "./install-button";
import { Reveal } from "./reveal";
import { Screens } from "./screens";
import { TryIt } from "./try-it";

// The public home page. Signed-out visitors (and search engines) opening `/`
// see this: the proxy rewrites `/` here, so the address stays `/`. Opening
// /welcome directly redirects to `/`, so it lives at one address only.
// The story: meet Pong, why Pong, what Pong does, try it, see it, questions.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/" },
};

const WRAP = "mx-auto w-full max-w-[1100px] px-6";
const H2 = "font-display text-3xl leading-tight font-semibold md:text-4xl";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-extrabold tracking-wide text-sea-dark uppercase">{children}</p>;
}

export default function WelcomePage() {
  return (
    <div className="min-h-dvh bg-mint text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData(siteUrl())) }}
      />

      {/* Top bar */}
      <header className="relative z-10 bg-sea">
        <div className={`${WRAP} flex h-16 items-center justify-between`}>
          <a
            href="#top"
            className="flex items-center gap-2 font-display text-xl font-semibold text-white"
          >
            <Pong mood="happy" size={36} decorative />
            Pong Money
          </a>
          <a
            href="#start"
            className="flex h-10 items-center rounded-full bg-white/15 px-4 text-sm font-extrabold text-white hover:bg-white/25"
          >
            Sign in
          </a>
        </div>
      </header>

      <main id="top">
        {/* 1. Meet Pong */}
        <section className="relative overflow-hidden bg-sea text-white">
          <div
            aria-hidden="true"
            className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-sea-light"
          />
          <div
            aria-hidden="true"
            className="absolute bottom-10 -left-16 h-44 w-44 rounded-full bg-sea-light"
          />
          <div
            aria-hidden="true"
            className="absolute top-24 left-[46%] h-4 w-4 rounded-full bg-sun"
          />
          <div
            aria-hidden="true"
            className="absolute top-12 right-[30%] h-2.5 w-2.5 rounded-full bg-sun"
          />

          <div
            className={`${WRAP} relative grid items-center gap-10 py-12 md:grid-cols-[1.1fr_1fr] md:py-20`}
          >
            <div className="order-2 flex flex-col gap-5 md:order-1">
              <h1 className="font-display text-[40px] leading-[1.05] font-semibold md:text-6xl">
                Know how much you can spend today.
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-sea-text">
                Pong is a financial helper app for Filipino paydays, bills and utang. Tell Pong when
                you get paid and what&apos;s due, and he&apos;ll tell you what&apos;s safe to spend
                each day.
              </p>
              <div
                id="start"
                className="flex max-w-md scroll-mt-24 flex-col gap-3 rounded-[28px] bg-card p-5 text-ink shadow-[0_18px_40px_-20px_rgba(0,0,0,0.5)]"
              >
                <Suspense fallback={null}>
                  <SignInError />
                </Suspense>
                <SignInPanel />
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-sea-text">
                <span>✓ Free</span>
                <span>✓ No bank passwords</span>
                <span>✓ Works on any phone</span>
              </p>
            </div>

            <div className="order-1 flex flex-col items-center md:order-2">
              <div className="pop-in relative mb-4 rounded-[24px] bg-card px-5 py-3.5 font-display text-xl font-semibold text-ink md:text-2xl">
                Hi! I&apos;m Pong, your money buddy.
                <span
                  aria-hidden="true"
                  className="absolute -bottom-2 left-1/2 block h-4 w-4 -translate-x-1/2 rotate-45 bg-card"
                />
              </div>
              <Pong
                mood="happy"
                size={260}
                className="pong-peek drop-shadow-[0_10px_0_rgba(0,0,0,0.12)]"
              />
            </div>
          </div>
        </section>

        {/* 2. Why Pong */}
        <Reveal aria-labelledby="why" className={`${WRAP} flex flex-col gap-8 py-16 md:py-24`}>
          <div className="flex flex-col gap-2">
            <Eyebrow>Why Pong</Eyebrow>
            <h2 id="why" className={H2}>
              Made for the money worries we all know
            </h2>
          </div>
          <ul className="grid gap-5 md:grid-cols-3">
            {WHY.map((w) => (
              <li key={w.worry} className="flex flex-col gap-3 rounded-[28px] bg-card p-6">
                <Pong mood={w.mood} size={84} className="reveal-pong" />
                <p className="font-display text-xl leading-snug font-semibold">{w.worry}</p>
                <p className="leading-relaxed text-muted">
                  <span aria-hidden="true" className="font-extrabold text-sea-dark">
                    →{" "}
                  </span>
                  {w.answer}
                </p>
              </li>
            ))}
          </ul>
          <p className="mx-auto max-w-2xl text-center text-lg leading-relaxed text-muted">
            Pong is a turtle: slow and steady with money, and always keeping something safe in his
            shell. 🐢
          </p>
        </Reveal>

        {/* 3. What Pong does */}
        <Reveal aria-labelledby="features" className="bg-card py-16 md:py-24">
          <div className={`${WRAP} flex flex-col gap-8`}>
            <div className="flex flex-col gap-2">
              <Eyebrow>What Pong does</Eyebrow>
              <h2 id="features" className={H2}>
                Everything your sweldo needs, in one app
              </h2>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className={`flex flex-col gap-2 rounded-[24px] ${f.tint} p-6`}>
                  <span aria-hidden="true" className="text-3xl">
                    {f.emoji}
                  </span>
                  <h3 className="text-lg font-extrabold">{f.title}</h3>
                  <p className="leading-relaxed text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        {/* 4. Try it */}
        <Reveal aria-labelledby="try" className={`${WRAP} flex flex-col gap-8 py-16 md:py-24`}>
          <div className="flex flex-col gap-2">
            <Eyebrow>Try it</Eyebrow>
            <h2 id="try" className={H2}>
              How much can I spend a day?
            </h2>
            <p className="max-w-2xl text-lg text-muted">
              Change the numbers and watch Pong. Nothing is saved, and you don&apos;t need to sign
              in.
            </p>
          </div>
          <TryIt />
        </Reveal>

        {/* 5. See it in the app */}
        <Reveal aria-labelledby="screens" className="overflow-hidden bg-sea-tint py-16 md:py-24">
          <div className={`${WRAP} flex flex-col gap-8`}>
            <div className="flex flex-col gap-2">
              <Eyebrow>See it in the app</Eyebrow>
              <h2 id="screens" className={H2}>
                Open the app, and Pong tells you what&apos;s safe today
              </h2>
            </div>
            <Screens />
            <InstallButton />
          </div>
        </Reveal>

        {/* 6. Questions */}
        <Reveal aria-labelledby="faq" className={`${WRAP} flex flex-col gap-8 py-16 md:py-24`}>
          <div className="flex flex-col gap-2">
            <Eyebrow>Questions</Eyebrow>
            <h2 id="faq" className={H2}>
              Good to know
            </h2>
          </div>
          <div className="grid items-start gap-3 md:grid-cols-2">
            {FAQ.map((f) => (
              <details key={f.question} className="group rounded-[20px] bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-bold [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sea-tint text-sea-dark transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                  {f.question}
                </summary>
                <p className="px-5 pb-5 pl-[3.75rem] leading-relaxed text-muted">{f.answer}</p>
              </details>
            ))}
          </div>
        </Reveal>

        {/* 7. Closing band */}
        <section className="relative overflow-hidden bg-sea text-white">
          <div
            aria-hidden="true"
            className="absolute -right-20 -bottom-24 h-72 w-72 rounded-full bg-sea-light"
          />
          <div
            className={`${WRAP} relative flex flex-col items-center gap-6 py-16 text-center md:flex-row md:text-left`}
          >
            <Pong mood="proud" size={150} className="pong-peek shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <h2 className="font-display text-3xl font-semibold md:text-4xl">
                Let&apos;s make every peso count.
              </h2>
              <p className="text-lg text-sea-text">
                Free to use. Sign in and set up in a few minutes.
              </p>
            </div>
            <a
              href="#start"
              className="flex h-14 shrink-0 items-center justify-center rounded-[18px] bg-sun px-8 text-[17px] font-extrabold text-ink"
            >
              Start for free
            </a>
          </div>
        </section>
      </main>

      {/* 8. Footer */}
      <footer className="bg-card">
        <div
          className={`${WRAP} flex flex-col items-center justify-between gap-2 py-6 text-sm text-muted sm:flex-row`}
        >
          <p>Pong Money · Made in the Philippines</p>
          <a href="#start" className="font-extrabold text-sea-dark underline underline-offset-4">
            Sign in
          </a>
        </div>
      </footer>
    </div>
  );
}

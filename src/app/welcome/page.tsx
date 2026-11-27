import { Pong } from "@/components/pong";
import { siteUrl } from "@/lib/site-url";
import { DESCRIPTION, FAQ, FEATURES, TITLE, WHY, jsonLd, structuredData } from "./content";
import { InstallButton } from "./install-button";
import { Reveal } from "./reveal";
import { Screens } from "./screens";
import { SiteNav, ThisYear } from "./site-nav";
import { StartCard } from "./start-card";
import { TryIt } from "./try-it";
import { Wave } from "./wave";

// The public home page. Signed-out visitors (and search engines) opening `/`
// see this: the proxy rewrites `/` here, so the address stays `/`. Opening
// /welcome directly redirects to `/`, so it lives at one address only.
// The story: meet Pong, why Pong, what Pong does, try it, see it, questions.
// Each coloured section ends in a wave of the next one's colour.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/" },
};

const WRAP = "mx-auto w-full max-w-[1100px] px-6";
const H2 = "scroll-mt-28 font-display text-3xl leading-tight font-semibold md:text-4xl";
/** Room at the bottom of a section for its wave. */
const PAD = "pt-16 pb-24 md:pt-24 md:pb-32";
const HEADLINE = "Know how much you can spend today.".split(" ");
const index = (i: number) => ({ "--i": i }) as React.CSSProperties;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-extrabold tracking-wide text-sea-dark uppercase">{children}</p>;
}

function FooterLinks({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-extrabold tracking-wide text-sun uppercase">{title}</p>
      <ul className="flex flex-col gap-2">
        {links.map(([href, label]) => (
          <li key={href}>
            <a href={href} className="text-sea-text hover:text-white hover:underline">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div id="top" className="landing min-h-dvh bg-mint text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData(siteUrl())) }}
      />

      <SiteNav />

      <main>
        {/* 1. Meet Pong */}
        <section className="relative overflow-hidden bg-sea text-white">
          <div
            aria-hidden="true"
            className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-sea-light"
          />
          <div
            aria-hidden="true"
            className="absolute bottom-16 -left-16 h-44 w-44 rounded-full bg-sea-light"
          />

          <div
            className={`${WRAP} relative grid items-center gap-10 pt-12 pb-24 md:grid-cols-[1.1fr_1fr] md:pt-20 md:pb-32`}
          >
            <div className="order-2 flex flex-col gap-5 md:order-1">
              <h1 className="font-display text-[40px] leading-[1.05] font-semibold md:text-6xl">
                {HEADLINE.map((word, i) => (
                  <span key={i}>
                    <span className="word-rise inline-block" style={index(i)}>
                      {word}
                    </span>{" "}
                  </span>
                ))}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-sea-text">
                Pong is a financial helper app for Filipino paydays, bills and utang. Tell Pong when
                you get paid and what&apos;s due, and he&apos;ll tell you what&apos;s safe to spend
                each day.
              </p>
              <StartCard />
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-sea-text">
                <span>✓ Free</span>
                <span>✓ No bank passwords</span>
                <span>✓ Works on any phone</span>
              </p>
            </div>

            <div className="relative order-1 flex flex-col items-center md:order-2">
              {/* Coins drifting up behind Pong. */}
              {[18, 34, 62, 78, 48].map((left, i) => (
                <span
                  key={left}
                  aria-hidden="true"
                  style={{ ...index(i), left: `${left}%` }}
                  className="coin absolute bottom-6 flex h-6 w-6 items-center justify-center rounded-full border-2 border-sun-text/30 bg-sun text-[11px] font-extrabold text-sun-text"
                >
                  ₱
                </span>
              ))}
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
                className="pong-peek relative drop-shadow-[0_10px_0_rgba(0,0,0,0.12)]"
              />
            </div>
          </div>
          <Wave className="text-mint" />
        </section>

        {/* 2. Why Pong */}
        <section aria-labelledby="why" className="relative bg-mint">
          <Reveal as="div" className={`${WRAP} flex flex-col gap-8 ${PAD}`}>
            <div className="flex flex-col gap-2">
              <Eyebrow>Why Pong</Eyebrow>
              <h2 id="why" className={H2}>
                Made for the money worries we all know
              </h2>
            </div>
            <ul className="grid gap-5 md:grid-cols-3">
              {WHY.map((w, i) => (
                <li
                  key={w.worry}
                  style={index(i)}
                  className="stagger flex flex-col gap-3 rounded-[28px] bg-card p-6 hover:-translate-y-1 hover:shadow-[0_14px_30px_-18px_rgba(0,0,0,0.35)]"
                >
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
          <Wave className="text-card" flip />
        </section>

        {/* 3. What Pong does */}
        <section aria-labelledby="features" className="relative bg-card">
          <Reveal as="div" className={`${WRAP} flex flex-col gap-8 ${PAD}`}>
            <div className="flex flex-col gap-2">
              <Eyebrow>What Pong does</Eyebrow>
              <h2 id="features" className={H2}>
                Everything your sweldo needs, in one app
              </h2>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <li
                  key={f.title}
                  style={index(i)}
                  className={`stagger flex flex-col gap-2 rounded-[24px] ${f.tint} p-6 hover:-translate-y-1 hover:shadow-[0_14px_30px_-18px_rgba(0,0,0,0.35)]`}
                >
                  <span aria-hidden="true" className="wiggle inline-block w-fit text-3xl">
                    {f.emoji}
                  </span>
                  <h3 className="text-lg font-extrabold">{f.title}</h3>
                  <p className="leading-relaxed text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
          <Wave className="text-mint" />
        </section>

        {/* 4. Try it */}
        <section aria-labelledby="try" className="relative bg-mint">
          <Reveal as="div" className={`${WRAP} flex flex-col gap-8 ${PAD}`}>
            <div className="flex flex-col gap-2">
              <Eyebrow>Try it</Eyebrow>
              <h2 id="try" className={H2}>
                How much can I spend a day?
              </h2>
              <p className="max-w-2xl text-lg text-muted">
                This is how Pong works it out, in three steps. Change the numbers and watch him.
                Nothing is saved, and you don&apos;t need to sign in.
              </p>
            </div>
            <TryIt />
          </Reveal>
          <Wave className="text-sea-tint" flip />
        </section>

        {/* 5. See it in the app */}
        <section aria-labelledby="screens" className="relative overflow-hidden bg-sea-tint">
          <Reveal as="div" className={`${WRAP} flex flex-col gap-8 ${PAD}`}>
            <div className="flex flex-col gap-2">
              <Eyebrow>See it in the app</Eyebrow>
              <h2 id="screens" className={H2}>
                Open the app, and Pong tells you what&apos;s safe today
              </h2>
            </div>
            <Screens />
            <InstallButton />
          </Reveal>
          <Wave className="text-mint" />
        </section>

        {/* 6. Questions */}
        <section aria-labelledby="faq" className="faq relative bg-mint">
          <Reveal
            as="div"
            className={`${WRAP} grid items-start gap-8 md:grid-cols-[minmax(0,320px)_1fr] md:gap-12 ${PAD}`}
          >
            <div className="flex flex-col gap-3 md:sticky md:top-28">
              <Eyebrow>Questions</Eyebrow>
              <h2 id="faq" className={H2}>
                Good to know
              </h2>
              <p className="text-lg leading-relaxed text-muted">
                Still curious? Sign in and look around. It&apos;s free.
              </p>
              <div className="mt-2 hidden md:block">
                <Pong mood="ask" size={120} className="reveal-pong" />
              </div>
            </div>
            <div className="divide-y divide-line overflow-hidden rounded-[24px] bg-card">
              {FAQ.map((f, i) => (
                <details key={f.question} style={index(i)} className="stagger group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-[17px] font-bold hover:bg-mint/60 [&::-webkit-details-marker]:hidden">
                    {f.question}
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sea-tint text-lg text-sea-dark transition-transform duration-300 group-open:rotate-45 group-open:bg-sea group-open:text-white"
                    >
                      +
                    </span>
                  </summary>
                  <p className="px-6 pb-6 leading-relaxed text-muted">{f.answer}</p>
                </details>
              ))}
            </div>
          </Reveal>
          <Wave className="text-sea" flip />
        </section>

        {/* 7. Closing band */}
        <section className="relative overflow-hidden bg-sea text-white">
          <div
            aria-hidden="true"
            className="absolute -right-20 -bottom-32 h-72 w-72 rounded-full bg-sea-light"
          />
          <div
            className={`${WRAP} relative flex flex-col items-center gap-6 pt-12 pb-20 text-center md:flex-row md:pb-24 md:text-left`}
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
              className="shine relative flex h-14 shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-sun px-8 text-[17px] font-extrabold text-ink transition-transform hover:scale-[1.03]"
            >
              Start for free
            </a>
          </div>
          <Wave className="text-sea-deep" />
        </section>
      </main>

      {/* 8. Footer */}
      <footer className="bg-sea-deep text-white">
        <div className={`${WRAP} grid gap-10 pt-10 pb-8 sm:grid-cols-[1.4fr_1fr_1fr]`}>
          <div className="flex flex-col gap-3">
            <a
              href="#top"
              className="flex items-center gap-2 font-display text-2xl font-semibold text-white"
            >
              <Pong mood="happy" size={44} decorative />
              Pong Money
            </a>
            <p className="max-w-xs leading-relaxed text-sea-text">
              Your financial helper for paydays, bills, utang and groceries.
            </p>
          </div>
          <FooterLinks
            title="Explore"
            links={[
              ["#why", "Why Pong"],
              ["#features", "Features"],
              ["#try", "Try it"],
              ["#faq", "Questions"],
            ]}
          />
          <FooterLinks
            title="Get started"
            links={[
              ["#start", "Start for free"],
              ["#screens", "Get the app"],
            ]}
          />
        </div>
        <div className="border-t border-white/15">
          <div
            className={`${WRAP} flex flex-col items-center justify-between gap-2 py-5 text-sm text-sea-text sm:flex-row`}
          >
            <p>
              © <ThisYear /> Pong Money · Made in the Philippines
            </p>
            <a href="#top" className="font-bold hover:text-white">
              Back to top ↑
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

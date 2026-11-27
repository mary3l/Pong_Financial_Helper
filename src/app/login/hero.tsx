import Link from "next/link";
import { Suspense } from "react";
import { Pong } from "@/components/pong";
import { SignInError, SignInPanel } from "./sign-in-panel";

/**
 * /login: Pong waving hello above the sign-in card on a phone, and beside it
 * on a computer. A link back to the landing page sits at the top.
 */
export function SignInHero({ intro }: { intro: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-sea">
      <div
        aria-hidden="true"
        className="absolute -top-16 -right-20 h-64 w-64 rounded-full bg-sea-light"
      />
      <div
        aria-hidden="true"
        className="absolute top-64 -left-12 h-36 w-36 rounded-full bg-sea-light"
      />
      <div
        aria-hidden="true"
        className="absolute top-28 left-14 h-[18px] w-[18px] rounded-full bg-sun"
      />
      <div
        aria-hidden="true"
        className="absolute top-20 right-24 h-2.5 w-2.5 rounded-full bg-sun"
      />

      <Link
        href="/"
        className="relative z-10 mx-4 mt-4 flex h-10 items-center self-start rounded-full bg-white/15 px-4 text-sm font-extrabold text-white hover:bg-white/25 lg:mx-8 lg:mt-6"
      >
        ← What&apos;s Pong?
      </Link>

      <div className="relative flex flex-1 flex-col lg:mx-auto lg:w-full lg:max-w-[1000px] lg:flex-row lg:items-center lg:justify-center lg:gap-16 lg:px-6 lg:pb-16">
        <div className="relative flex flex-1 flex-col items-center justify-center pt-6 pb-8 lg:flex-none lg:p-0">
          <div className="relative mb-3.5 rounded-[20px] bg-card px-[18px] py-3 font-display text-xl font-semibold text-ink">
            Hi! I&apos;m Pong.
            <span
              aria-hidden="true"
              className="absolute -bottom-2 left-1/2 block h-4 w-4 -translate-x-1/2 rotate-45 bg-card"
            />
          </div>
          <Pong
            mood="happy"
            size={230}
            decorative
            className="pong-peek lg:h-[300px] lg:w-[300px]"
          />
        </div>

        <div className="relative mx-auto flex w-full max-w-md flex-col gap-[18px] rounded-t-[32px] bg-card px-6 pt-8 pb-9 md:mb-10 md:rounded-[32px] lg:mx-0 lg:mb-0 lg:w-[440px] lg:shrink-0 lg:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]">
          <h1 className="font-display text-[32px] leading-tight font-semibold">
            Let&apos;s make every peso count
          </h1>
          <p className="text-base leading-relaxed text-muted">{intro}</p>
          <Suspense fallback={null}>
            <SignInError />
          </Suspense>
          <SignInPanel />
        </div>
      </div>
    </div>
  );
}

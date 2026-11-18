import { Suspense } from "react";
import { Pong } from "@/components/pong";
import { SignInError, SignInPanel } from "./sign-in-panel";

export const metadata = { title: "Sign in · Pong Money" };

export default function LoginPage() {
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

      <div className="relative flex flex-1 flex-col items-center justify-center pt-16 pb-8">
        <div className="relative mb-3.5 rounded-[20px] bg-card px-[18px] py-3 font-display text-xl font-semibold text-ink">
          Hi! I&apos;m Pong.
          <span
            aria-hidden="true"
            className="absolute -bottom-2 left-1/2 block h-4 w-4 -translate-x-1/2 rotate-45 bg-card"
          />
        </div>
        <Pong mood="happy" size={230} decorative />
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-col gap-[18px] rounded-t-[32px] bg-card px-6 pt-8 pb-9 md:mb-10 md:rounded-[32px]">
        <h1 className="font-display text-[32px] leading-tight font-semibold">
          Let&apos;s make every peso count
        </h1>
        <p className="text-base leading-relaxed text-muted">
          I&apos;ll watch your bills, paydays and pautang, and tell you how much you can safely
          spend each day.
        </p>
        <Suspense fallback={null}>
          <SignInError />
        </Suspense>
        <SignInPanel />
      </div>
    </div>
  );
}

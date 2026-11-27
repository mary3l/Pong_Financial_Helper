"use client";

import { Suspense, useSyncExternalStore } from "react";
import { SignInError, SignInPanel } from "@/app/login/sign-in-panel";
import { formatPeso } from "@/lib/money";
import { getDemoPick, subscribeDemo } from "./demo-store";

/**
 * The sign-in card in the hero (`#start`). After "Let Pong track it for real"
 * it glows once and says what Pong will keep on track.
 */
export function StartCard() {
  const pick = useSyncExternalStore(subscribeDemo, getDemoPick, () => null);

  return (
    <div
      id="start"
      className="relative flex max-w-md scroll-mt-28 flex-col gap-3 rounded-[28px] bg-card p-5 text-ink shadow-[0_18px_40px_-20px_rgba(0,0,0,0.5)]"
    >
      {pick && (
        <>
          {/* A new key on every tap replays the pulse. */}
          <span
            key={pick.at}
            aria-hidden="true"
            className="ring-pulse pointer-events-none absolute -inset-1 rounded-[32px] border-4 border-sun"
          />
          <p role="status" className="pop-in rounded-[16px] bg-sun-tint px-4 py-3 font-bold">
            {pick.daily > 0 ? (
              <>
                Sign in and Pong will keep your{" "}
                <span className="text-sun-text">{formatPeso(pick.daily)} a day</span> on track.
              </>
            ) : (
              <>Sign in and Pong will help you find room in your sweldo.</>
            )}
          </p>
        </>
      )}
      <Suspense fallback={null}>
        <SignInError />
      </Suspense>
      <SignInPanel />
    </div>
  );
}

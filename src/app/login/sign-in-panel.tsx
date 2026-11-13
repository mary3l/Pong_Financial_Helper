"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { GoogleIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

type Step = "choose" | "email" | "sent";

export function SignInPanel() {
  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callbackUrl = () => `${window.location.origin}/auth/callback`;

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      // Always show Google's account chooser, so a second account (or a
      // demo one) can sign in instead of the last one used.
      options: { redirectTo: callbackUrl(), queryParams: { prompt: "select_account" } },
    });
    // On success the browser is already leaving for Google.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function sendEmailLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
    } else {
      setStep("sent");
    }
  }

  if (step === "sent") {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-[18px] bg-sea-tint p-4">
        <p className="font-bold">Check your email</p>
        <p className="text-[15px] text-muted">
          We sent a sign-in link to <strong className="text-ink">{email}</strong>.
          Open it on this device to continue.
        </p>
        <button
          type="button"
          onClick={() => setStep("email")}
          className="self-start font-extrabold text-sea-dark underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-[14px] bg-coral-tint px-4 py-3 text-sm font-bold text-coral-text">
          {error}
        </p>
      )}

      {step === "choose" ? (
        <>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={busy}
            className="flex h-14 items-center justify-center gap-2.5 rounded-[18px] bg-sun text-[17px] font-extrabold text-ink disabled:opacity-60"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => setStep("email")}
            className="flex h-[52px] items-center justify-center rounded-[18px] border-2 border-line font-bold text-ink hover:bg-mint"
          >
            Sign in with email
          </button>
        </>
      ) : (
        <form onSubmit={sendEmailLink} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-bold">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-[52px] rounded-[14px] border-2 border-line px-4 text-base outline-none focus:border-sea"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex h-14 items-center justify-center rounded-[18px] bg-sun text-[17px] font-extrabold text-ink disabled:opacity-60"
          >
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
          <button
            type="button"
            onClick={() => setStep("choose")}
            className="h-11 font-bold text-muted"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
}

/** Shown when /auth/callback couldn't finish signing in. */
export function SignInError() {
  const failed = useSearchParams().get("error") === "signin";
  if (!failed) return null;
  return (
    <p role="alert" className="rounded-[14px] bg-coral-tint px-4 py-3 text-sm font-bold text-coral-text">
      That sign-in link didn&apos;t work. It may have expired or been opened on
      another device. Please try again.
    </p>
  );
}

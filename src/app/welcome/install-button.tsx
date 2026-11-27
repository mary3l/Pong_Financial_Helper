"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void> };

const noChange = () => () => {};
/** True on an iPhone or iPad, which can't hand over an install prompt. */
const useIos = () =>
  useSyncExternalStore(
    noChange,
    () => /iPhone|iPad|iPod/.test(navigator.userAgent),
    () => false,
  );
/** True when Pong is already running as an installed app. Hidden on the server. */
const useStandalone = () =>
  useSyncExternalStore(
    noChange,
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => true,
  );

/**
 * "Add Pong to your home screen". Chrome and Android hand over an install
 * prompt; iPhones can't, so they get the Share → Add to Home Screen tip.
 * Hidden when Pong is already installed.
 */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const ios = useIos();
  const standalone = useStandalone();
  const [justInstalled, setJustInstalled] = useState(false);
  const installed = standalone || justInstalled;
  const [tip, setTip] = useState(false);

  useEffect(() => {
    const keep = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const done = () => setJustInstalled(true);
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            setPrompt(null);
          } else {
            setTip((t) => !t);
          }
        }}
        className="flex h-12 items-center justify-center rounded-[16px] border-2 border-line bg-card px-5 font-extrabold text-ink hover:bg-mint"
      >
        Add Pong to your home screen
      </button>
      {tip && (
        <p role="status" className="text-center text-sm text-muted">
          Tap <strong className="text-ink">Share</strong>, then{" "}
          <strong className="text-ink">Add to Home Screen</strong>.
        </p>
      )}
    </div>
  );
}

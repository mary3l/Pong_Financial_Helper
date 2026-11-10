"use client";

import { useActionState, useEffect, useState } from "react";
import { createWidgetKey, turnOffWidget, type WidgetKeyState } from "@/app/widget-actions";

/** Settings › Home screen widget: the Scriptable script and its widget key. */
export function WidgetSetup({ keyMadeOn }: { keyMadeOn: string | null }) {
  const [made, make, making] = useActionState<WidgetKeyState>(createWidgetKey, {});
  const [off, turnOff, turningOff] = useActionState<WidgetKeyState>(turnOffWidget, {});
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState<"script" | "code" | null>(null);

  // Load the script up front: iPhone Safari only lets a tap copy right away.
  useEffect(() => {
    fetch("/pong-widget.js")
      .then((r) => (r.ok ? r.text() : null))
      .then(setScript, () => setScript(null));
  }, []);

  async function copy(what: "script" | "code", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  const error = made.error ?? off.error;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] text-muted">
        See what&apos;s left of today&apos;s Safe to spend on your iPhone home screen. It uses
        Scriptable, a free app from the App Store. The widget can only read today&apos;s spending
        and the daily amount Home last worked out; it can&apos;t see balances or change anything.
        Already set it up? Copy the script again to get the new look.
      </p>

      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[15px]">
        <li>Install Scriptable, open it and tap <strong>+</strong> to make a new script.</li>
        <li>
          Copy the widget script and paste it in. Name it <strong>Pong Money</strong>.
        </li>
        <li>Make a widget key below and copy the setup code.</li>
        <li>Run the script once in Scriptable and paste the setup code when it asks.</li>
        <li>
          On your home screen, add a Scriptable widget, tap it while editing and choose{" "}
          <strong>Pong Money</strong> as the script.
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!script}
          onClick={() => script && copy("script", script)}
          className="h-12 rounded-[18px] border-2 border-line px-5 font-bold text-ink hover:bg-mint disabled:opacity-60"
        >
          {copied === "script" ? "Script copied" : "Copy widget script"}
        </button>
        <a
          href="/pong-widget.js"
          target="_blank"
          className="flex h-12 items-center rounded-[18px] px-3 font-bold text-sea-dark underline"
        >
          View script
        </a>
      </div>

      {made.setupCode && (
        <div className="flex flex-col gap-2 rounded-[18px] bg-sun-tint p-4">
          <label htmlFor="setup_code" className="text-sm font-bold">
            Setup code
          </label>
          <p className="text-sm text-sun-text">
            Copy it now: it&apos;s only shown once. Anyone with it can see what you spend each day.
          </p>
          <textarea
            id="setup_code"
            readOnly
            rows={3}
            value={made.setupCode}
            onFocus={(e) => e.currentTarget.select()}
            className="rounded-[14px] border-2 border-line bg-card p-3 font-mono text-xs break-all"
          />
          <button
            type="button"
            onClick={() => copy("code", made.setupCode!)}
            className="h-12 w-fit rounded-[18px] bg-sun px-5 font-extrabold text-ink"
          >
            {copied === "code" ? "Setup code copied" : "Copy setup code"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form action={make}>
          <button
            type="submit"
            disabled={making}
            className="h-12 rounded-[18px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60"
          >
            {making ? "Making…" : keyMadeOn ? "Make a new widget key" : "Make widget key"}
          </button>
        </form>
        {keyMadeOn && (
          <form action={turnOff}>
            <button
              type="submit"
              disabled={turningOff}
              className="h-12 rounded-[18px] border-2 border-line px-5 font-bold text-ink hover:bg-mint disabled:opacity-60"
            >
              {turningOff ? "Turning off…" : "Turn off widget"}
            </button>
          </form>
        )}
      </div>

      <p role={error ? "alert" : "status"} className={`text-sm ${error ? "font-bold text-coral-text" : "text-muted"}`}>
        {error ??
          (keyMadeOn
            ? `Widget key made ${keyMadeOn}. A new key stops the old one from working.`
            : "No widget key yet.")}
      </p>
    </div>
  );
}

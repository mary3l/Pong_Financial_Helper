"use client";

import { useEffect, useRef, useState } from "react";
import { Pong } from "@/components/pong";
import type { Receipt } from "@/lib/receipt";
import { pongImage, receiptPng } from "./receipt-image";

type Status = "copied-image" | "copied-text" | "saved" | "failed" | null;

const MESSAGES: Record<Exclude<Status, null>, string> = {
  "copied-image": "Image copied! Paste it in a chat",
  "copied-text": "Text copied! Paste it in a chat",
  saved: "Image saved. Attach it in a chat",
  failed: "Couldn't do that here. Try Copy text.",
};

/**
 * The breakdown as a receipt card with Pong (PNG), shown here first: copy
 * it as a picture to paste in a chat (saved instead where copying pictures
 * isn't allowed). Copy text gives the same breakdown as plain text.
 */
export function ShareText({
  text,
  receipt,
  filename,
}: {
  text: string;
  receipt: Receipt;
  /** "breakdown-tita-flora.png" */
  filename: string;
}) {
  const pongRef = useRef<HTMLDivElement>(null);
  const [png, setPng] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  // Drawn once the page is up, so the buttons work straight away (Safari needs it ready when tapped).
  // Redrawn only when what it says changes.
  const content = JSON.stringify(receipt);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const svg = pongRef.current?.querySelector("svg");
    (async () => {
      const pong = svg ? await pongImage(svg).catch(() => null) : null;
      const blob = await receiptPng(JSON.parse(content) as Receipt, pong);
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setPng(blob);
      setPreview(url);
    })().catch(() => setPng(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [content]);

  function save(blob: Blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus("saved");
  }

  async function copyImage() {
    setStatus(null);
    if (!png) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setStatus("copied-image");
    } catch {
      save(png);
    }
  }

  async function copyText() {
    setStatus(null);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied-text");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <section aria-labelledby="share-heading" className="flex flex-col gap-3 rounded-[24px] bg-card p-4">
      <h2 id="share-heading" className="font-display text-xl font-semibold">Send breakdown</h2>
      {/* Pong, drawn onto the image. */}
      <div ref={pongRef} aria-hidden="true" className="hidden">
        <Pong mood={receipt.mood} size={250} decorative />
      </div>
      <div className="flex justify-center rounded-[20px] bg-sea-tint p-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL drawn in the browser
          <img src={preview} alt={`Breakdown for ${receipt.title}, ready to send`} className="w-full max-w-[360px] rounded-[16px]" />
        ) : (
          <div className="flex aspect-[3/4] w-full max-w-[360px] animate-pulse items-center justify-center rounded-[16px] bg-card">
            <Pong mood="peek" size={90} decorative />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={copyImage}
          disabled={!png}
          className="h-12 rounded-[16px] bg-sea font-extrabold text-white disabled:opacity-60"
        >
          {png ? "Copy image" : "Pong is drawing it…"}
        </button>
        <button type="button" onClick={copyText} className="h-12 rounded-[16px] border-2 border-sea font-extrabold text-sea-dark">
          Copy text
        </button>
      </div>
      <p role="status" className="text-center text-[13px] font-bold text-sea-dark empty:hidden">
        {status ? MESSAGES[status] : ""}
      </p>
    </section>
  );
}

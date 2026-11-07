"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { scanStrip } from "@/lib/scan-strip";

// The camera view for Grocery mode. Uses the browser's BarcodeDetector where
// it can read grocery barcodes (Chrome on Android) and @zxing/library
// otherwise (iPhone Safari), loaded only when needed.
//
// Safari opens the camera at 640×480 unless asked for more, which leaves a
// shelf-tag barcode about 1.5 pixels per bar: too few to read. So we ask for
// full HD, keep the lens focusing, and decode only the strip around the
// yellow guide, at full detail.

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
/** Height of the strip we read, CSS px. The guide box is 96px tall. */
const STRIP_H = 180;
const EVERY_MS = 120;

type Decode = (frame: HTMLCanvasElement) => Promise<string | null>;
type Detector = { detect: (source: HTMLCanvasElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

/** The built-in detector, if this browser has one that reads EAN-13. */
async function nativeDecoder(): Promise<Decode | null> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!Native?.getSupportedFormats) return null;
  try {
    const supported = await Native.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    if (!formats.includes("ean_13")) return null;
    const detector = new Native({ formats });
    return async (frame) => (await detector.detect(frame))[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

async function zxingDecoder(): Promise<Decode> {
  const { decodeLuminance, luminance } = await import("@/lib/barcode-decode");
  return async (frame) => {
    const { width, height } = frame;
    const rgba = frame.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
    return decodeLuminance(luminance(rgba, width, height), width, height);
  };
}

export function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const found = useEffectEvent((code: string) => onDetected(code));

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slowTimer = setTimeout(() => setSlow(true), 8000);
    const el = video.current!;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const [track] = stream.getVideoTracks();
      const caps = track.getCapabilities?.() as { focusMode?: string[] } | undefined;
      if (caps?.focusMode?.includes("continuous")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      }
      el.srcObject = stream;
      await el.play();
      const decode = (await nativeDecoder()) ?? (await zxingDecoder());

      async function tick() {
        if (stopped) return;
        if (el.readyState >= 2 && el.videoWidth) {
          const { source, outW, outH } = scanStrip(el.videoWidth, el.videoHeight, el.clientWidth, el.clientHeight, STRIP_H);
          if (canvas.width !== outW || canvas.height !== outH) {
            canvas.width = outW;
            canvas.height = outH;
          }
          ctx.drawImage(el, source.x, source.y, source.width, source.height, 0, 0, outW, outH);
          const code = await decode(canvas).catch(() => null);
          if (code && !stopped) {
            stopped = true;
            found(code);
            return;
          }
        }
        timer = setTimeout(tick, EVERY_MS);
      }
      tick();
    }

    start().catch((err: unknown) => {
      if (stopped) return;
      const name = err instanceof DOMException ? err.name : "";
      setProblem(
        name === "NotAllowedError"
          ? "Camera is blocked. Allow it in your browser settings, or type the price below."
          : "Couldn't open the camera. Type the price below instead.",
      );
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-[20px] bg-scrim">
      <video ref={video} muted playsInline className="aspect-[4/3] w-full object-cover" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-2xl border-4 border-sun" />
      <p role="status" className="absolute inset-x-0 bottom-0 bg-scrim/80 px-4 py-2 text-center text-sm font-bold text-white">
        {problem ?? (slow ? "Still looking. Fill the box with the barcode and hold still." : "Point at the barcode")}
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close camera"
        className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
      >
        <CloseIcon size={18} />
      </button>
    </div>
  );
}

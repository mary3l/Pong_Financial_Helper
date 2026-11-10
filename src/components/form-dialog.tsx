"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "@/components/icons";

// Every add and edit form opens in this: a sheet from the bottom on phones,
// a centered dialog from sm up. Esc, the ✕ and tapping outside all close it.
// Render it only while open ({editing && <FormDialog …>}), or pass `open`.
export function FormDialog({
  title,
  onClose,
  open = true,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  open?: boolean;
  /** Room for wider forms (a table of shares, two columns). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The latest onClose, so the effect below doesn't re-run on every render.
  const close = useRef(onClose);
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    if (!dialog.open) dialog.showModal();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby="form-dialog-title"
      onCancel={(e) => {
        // React bubbles cancel from a dialog inside this one (AmountInput's
        // calculator): Esc there closes only that one.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        close.current();
      }}
      // A press that started inside (selecting text, then letting go past
      // the edge) isn't a tap outside.
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      // A click on the backdrop lands on the <dialog> itself.
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) close.current();
        downOnBackdrop.current = false;
      }}
      className={`mx-0 mt-auto mb-0 max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[28px] bg-mint p-0 text-ink backdrop:bg-scrim/50 sm:m-auto sm:max-h-[calc(100dvh-48px)] sm:w-[calc(100%-48px)] sm:rounded-[28px] sm:shadow-[0_24px_60px_rgba(18,48,42,0.35)] ${
        wide ? "sm:max-w-2xl" : "sm:max-w-lg"
      }`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-mint px-5 pt-4 pb-2">
        <h2 id="form-dialog-title" className="font-display text-xl font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => close.current()}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-ink hover:bg-sea-tint"
        >
          <CloseIcon size={20} />
        </button>
      </div>
      <div className="px-5 pt-1 pb-[max(20px,env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  );
}

"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { CalculatorIcon, CloseIcon } from "@/components/icons";
import { Keypad } from "@/components/keypad";
import {
  amountToExpression,
  evaluate,
  expressionFromText,
  hasOperator,
  keyFromKeyboard,
  press,
  prettyExpression,
  type Key,
} from "@/lib/calculator";
import { formatPeso } from "@/lib/money";

// An amount field that can do math, so you never need the phone's own
// calculator. Tapping or clicking it opens Pong's keypad (phones need it:
// their number keyboard has no + or −). Reaching it with Tab still lets you
// type, "120+45" included, worked out on Enter or when you leave the field.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onChange: (value: string) => void;
  /** What the amount is for, shown on the calculator. Defaults to aria-label. */
  label?: string;
  /** Classes for the box holding the field and the calculator button. */
  wrapperClassName?: string;
};

export function AmountInput({ value, onChange, label, wrapperClassName = "w-full", className = "", onBlur, onKeyDown, ...rest }: Props) {
  // The sheet's title: `label`, else the field's aria-label or <label>.
  const [open, setOpen] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const named = label ?? rest["aria-label"];

  function openCalculator() {
    setOpen(named ?? inputRef.current?.labels?.[0]?.textContent?.trim() ?? "Amount");
  }

  /** Replaces a typed sum with its answer; false if there was nothing to work out. */
  function settle(): boolean {
    const expr = expressionFromText(value);
    if (!expr || !hasOperator(expr)) return false;
    const result = evaluate(expr);
    if (result === null || result < 0) return false;
    onChange(amountToExpression(result));
    return true;
  }

  return (
    // A grid, not `relative`: a positioned box here would paint over the
    // ₱ that most callers lay over the field.
    <div className={`grid ${wrapperClassName}`}>
      <input
        {...rest}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // A tap opens Pong's calculator, once the finger is up: opened on
        // press, the sheet would slide up under the finger and the release
        // would land on it (closing it, or pressing a key).
        onClick={(e) => {
          rest.onClick?.(e);
          if (e.defaultPrevented || rest.disabled || rest.readOnly) return;
          openCalculator();
        }}
        onBlur={(e) => {
          settle();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          // Enter on "120+45" shows 165 first, like a calculator's =.
          if (e.key === "Enter" && settle()) e.preventDefault();
          onKeyDown?.(e);
        }}
        type="text"
        // No phone keyboard: Pong's keypad is how amounts go in on a phone.
        // A computer's own keyboard still types into it.
        inputMode="none"
        autoComplete="off"
        className={`${className} col-start-1 row-start-1 w-full pr-11`}
      />
      <button
        ref={buttonRef}
        type="button"
        onClick={openCalculator}
        aria-label={named ? `Calculator for ${named}` : "Calculator"}
        className="col-start-1 row-start-1 mr-1 flex h-8 w-8 items-center justify-center self-center justify-self-end rounded-[10px] text-sea-dark hover:bg-sea-tint"
      >
        <CalculatorIcon size={19} />
      </button>
      {open !== null && (
        <CalculatorSheet
          start={value}
          label={open}
          onUse={(amount) => onChange(amount ? amountToExpression(amount) : "")}
          onClose={() => {
            setOpen(null);
            buttonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Pong's keypad in a sheet from the bottom on phones, a small dialog from lg up. */
function CalculatorSheet({
  start,
  label,
  onUse,
  onClose,
}: {
  start: string;
  label: string;
  onUse: (amount: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Only a tap that starts and ends outside the sheet closes it.
  const downOnBackdrop = useRef(false);
  const [calc, setCalc] = useState<{ expr: string; error: string | null }>(() => {
    const expr = expressionFromText(start) ?? "";
    const v = evaluate(expr);
    return { expr: v && v > 0 ? expr : "", error: null };
  });
  const value = evaluate(calc.expr);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
    };
  }, []);

  function pressKey(key: Key) {
    setCalc((c) => {
      const r = press(c.expr, key);
      return { expr: r.expr, error: r.error ?? null };
    });
  }

  function apply() {
    if (value === null) return setCalc((c) => ({ ...c, error: "Can't divide by 0" }));
    if (value < 0) return setCalc((c) => ({ ...c, error: "Amount can't be negative" }));
    onUse(value);
    onClose();
  }

  function keyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Keep keys away from the page under the sheet, e.g. the Add screen's keypad.
    e.stopPropagation();
    if (e.key === "Enter") {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      apply();
      return;
    }
    const key = keyFromKeyboard(e.key);
    if (key) {
      e.preventDefault();
      pressKey(key);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label={`Calculator for ${label}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={keyDown}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
        downOnBackdrop.current = false;
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-[28px] bg-mint p-0 text-ink backdrop:bg-scrim/50 lg:m-auto lg:max-w-[400px] lg:rounded-[28px] lg:shadow-[0_24px_60px_rgba(18,48,42,0.35)]"
    >
      <div className="flex flex-col gap-3 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-extrabold">{label}</span>
          <button type="button" onClick={onClose} aria-label="Close calculator" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card">
            <CloseIcon size={16} />
          </button>
        </div>
        <div aria-live="polite" className="flex flex-col items-end rounded-[20px] bg-card px-4 py-2.5">
          <span className="min-h-6 text-[17px] font-bold text-muted">
            {hasOperator(calc.expr) ? prettyExpression(calc.expr) : " "}
          </span>
          <span className="font-display text-[40px] leading-[1.05] font-semibold">{formatPeso(Math.max(0, value ?? 0))}</span>
          <span className={`min-h-5 text-sm font-bold ${calc.error ? "text-coral-text" : "text-muted"}`}>
            {calc.error ?? "Add them up, like 120 + 45 + 20."}
          </span>
        </div>
        <Keypad onPress={pressKey} className="grid-rows-[repeat(5,52px)]" />
        <button type="button" onClick={apply} className="h-14 rounded-[18px] bg-sun text-[17px] font-extrabold text-ink">
          {value && value > 0 ? `Use ${formatPeso(value)}` : "Use ₱0"}
        </button>
      </div>
    </dialog>
  );
}

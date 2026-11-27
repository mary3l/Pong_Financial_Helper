import type { PongMood } from "@/components/pong";

// The landing page's "Try it" demo: a rough daily amount until payday. The
// real app also counts loans, cards and what's already spent; this is only a
// taste, worked out in the browser and never saved.

/** A typed amount as pesos: blank, junk or negative counts as 0. */
export function pesos(text: string): number {
  const value = Number(text.replace(/[,\s₱]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Days until payday, kept between 1 and 31. */
export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 1;
  return Math.min(31, Math.max(1, Math.round(days)));
}

/** (sweldo − bills − savings) ÷ days, rounded down to the peso. */
export function dailySafe(pay: number, bills: number, savings: number, days: number): number {
  return Math.floor((pay - bills - savings) / clampDays(days));
}

/** Pong's face and words for a daily amount. */
export function pongFor(daily: number): { mood: PongMood; message: string } {
  if (daily >= 500) return { mood: "proud", message: "Ang galing! That's room to breathe." };
  if (daily >= 200) return { mood: "happy", message: "Kaya 'yan! That's enough to get by." };
  if (daily >= 1)
    return { mood: "worried", message: "Tight, but doable. Let's watch it together." };
  return { mood: "shocked", message: "Uh-oh. The bills are bigger than this sweldo." };
}

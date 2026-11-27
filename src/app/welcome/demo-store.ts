// A tiny in-browser store shared by Try it and the sign-in card. When someone
// taps "Let Pong track it for real", Try it saves the daily amount here and
// the sign-in card glows and repeats it. Nothing leaves the browser.

export type DemoPick = { daily: number; at: number } | null;

let pick: DemoPick = null;
const listeners = new Set<() => void>();

export function subscribeDemo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDemoPick(): DemoPick {
  return pick;
}

/** Remember the amount and tell the sign-in card to glow. */
export function pickDemo(daily: number): void {
  pick = { daily, at: Date.now() };
  listeners.forEach((l) => l());
}

/** For tests: forget the last pick. */
export function resetDemo(): void {
  pick = null;
  listeners.forEach((l) => l());
}

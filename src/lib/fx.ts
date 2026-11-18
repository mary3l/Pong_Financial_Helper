import "server-only";
import { cacheLife } from "next/cache";

// Today's US dollar to peso rate, for valuing dollar wallets (a GoTyme USD
// Time Deposit). Free rate feeds update once a day, so this is the day's
// rate, not a live market quote. It's checked every hour and shared by every
// request; when no feed answers, wallets use the rate you set on them.

export type UsdRate = {
  /** Pesos per US$1. */
  rate: number;
  /** "2026-11-05": the day the feed last updated. */
  asOf: string;
  /** Where it came from, to credit it. */
  source: { name: string; url: string };
};

/** A peso rate that makes sense, so a broken feed can't value your dollars at ₱0. */
function sane(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 10 && rate < 500;
}

async function fromExchangeRateApi(): Promise<UsdRate | null> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_unix?: number;
  };
  const rate = data.rates?.PHP;
  if (data.result !== "success" || !sane(rate) || !data.time_last_update_unix) return null;
  return {
    rate,
    asOf: new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10),
    source: { name: "ExchangeRate-API", url: "https://www.exchangerate-api.com" },
  };
}

async function fromFrankfurter(): Promise<UsdRate | null> {
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP", {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const rate = data.rates?.PHP;
  if (!sane(rate) || !data.date) return null;
  return { rate, asOf: data.date, source: { name: "Frankfurter", url: "https://frankfurter.dev" } };
}

/** Today's USD → PHP rate, or null when no feed answers. */
export async function getUsdRate(): Promise<UsdRate | null> {
  "use cache";
  for (const feed of [fromExchangeRateApi, fromFrankfurter]) {
    try {
      const found = await feed();
      if (found) {
        cacheLife("hours");
        return { ...found, rate: Math.round(found.rate * 10000) / 10000 };
      }
    } catch {
      // Offline or timed out: try the next feed.
    }
  }
  // Try again soon rather than keeping "no rate" for hours.
  cacheLife("minutes");
  return null;
}

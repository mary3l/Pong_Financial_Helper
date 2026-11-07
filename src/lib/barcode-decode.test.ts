import { describe, expect, it } from "vitest";
import { decodeLuminance } from "./barcode-decode";
import { scanStrip } from "./scan-strip";

// EAN-13 bars, built by hand so the test needs no barcode writer.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => [...p].reverse().join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

function ean13(code: string): string {
  const d = [...code].map(Number);
  let bars = "101";
  for (let i = 1; i <= 6; i++) bars += (PARITY[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bars += "01010";
  for (let i = 7; i <= 12; i++) bars += R[d[i]];
  return bars + "101";
}

/** A shelf-tag-like image: short bars on a white strip, `px` pixels per bar. */
function render(code: string, px: number) {
  const bars = "0".repeat(10) + ean13(code) + "0".repeat(10);
  const width = Math.ceil(bars.length * px);
  const height = 120;
  const lum = new Uint8ClampedArray(width * height).fill(235);
  for (let x = 0; x < width; x++) {
    if (bars[Math.floor(x / px)] !== "1") continue;
    for (let y = 45; y < 75; y++) lum[y * width + x] = 25;
  }
  return { lum, width, height };
}

describe("decodeLuminance", () => {
  it("reads the EAN-13 on a shelf tag", () => {
    const { lum, width, height } = render("4806501709260", 3);
    expect(decodeLuminance(lum, width, height)).toBe("4806501709260");
  });

  it("returns null when there's no barcode", () => {
    expect(decodeLuminance(new Uint8ClampedArray(200 * 100).fill(200), 200, 100)).toBeNull();
  });
});

describe("scanStrip", () => {
  it("reads a strip across the middle of a portrait 1080p frame shown in a 4:3 box", () => {
    // 360×270 box, frame 1080×1920: cover scale is 1/3, so 810 frame px of height show.
    const { source, outW, outH } = scanStrip(1080, 1920, 360, 270, 180);
    expect(source.width).toBe(1015);
    expect(source.height).toBe(540);
    expect(source.x).toBe(33);
    expect(source.y).toBe(690);
    expect(outW).toBe(1015);
    expect(outH).toBe(540);
  });

  it("caps the output width so slow phones stay quick", () => {
    const { outW, outH } = scanStrip(1920, 1440, 400, 300, 180, 1280);
    expect(outW).toBe(1280);
    expect(outH).toBe(Math.round(864 * (1280 / 1805)));
  });

  it("never reads taller than what's on screen", () => {
    const { source } = scanStrip(640, 480, 400, 300, 999);
    expect(source.height).toBe(480);
  });
});

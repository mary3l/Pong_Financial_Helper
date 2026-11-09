import type { Receipt } from "@/lib/receipt";

// Draws a breakdown as a receipt card (PNG) for Send image, with Pong in the
// header saying something. Always the light theme, so it reads the same in
// any chat. Browser only.

const W = 1080;
const PAD = 64;
const C = {
  page: "#dff3ea",
  card: "#ffffff",
  sea: "#13795a",
  seaDeep: "#0e5c44",
  seaText: "#e6f7ef",
  seaTint: "#dff3ea",
  ink: "#12302a",
  muted: "#4d6b63",
  line: "#d9e9e1",
  coral: "#a3321b",
  coralTint: "#fde6df",
  sun: "#ffc93c",
  sunTint: "#fff3cc",
  sunText: "#8a5a00",
};

/** Pong's size in the header, and how far he sits from the right edge. */
const PONG = 250;

/** next/font's family names, from the CSS variables layout.tsx sets. */
function fonts() {
  const style = getComputedStyle(document.body);
  const pick = (name: string) => style.getPropertyValue(name).trim() || "system-ui, sans-serif";
  return { display: pick("--font-fredoka"), body: pick("--font-nunito") };
}

/** Splits `text` into lines no wider than `max`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fillRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[], fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

const BADGE = { paid: [C.seaTint, C.sea], part: [C.sunTint, C.sunText], open: [C.coralTint, C.coral] } as const;

/** Lays the receipt out; with `draw` false it only measures. Returns the card's bottom edge. */
function layout(ctx: CanvasRenderingContext2D, r: Receipt, pong: CanvasImageSource | null, draw: boolean): number {
  const f = fonts();
  const cardL = PAD;
  const cardR = W - PAD;
  const left = cardL + 56;
  const right = cardR - 56;
  const text = (s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left") => {
    ctx.font = font;
    if (!draw) return;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };

  // ── Header: the title on the left, Pong and his speech bubble on the right.
  const textMax = right - left - PONG + 10;
  ctx.font = `600 68px ${f.display}`;
  const titleLines = wrap(ctx, r.title, textMax);
  const bubbleTop = PAD + 44;
  const textH = 64 + 44 + titleLines.length * 76 + 50;
  const headerH = Math.max(textH + 40, 150 + PONG);
  if (draw) {
    fillRound(ctx, cardL, PAD, cardR - cardL, headerH, [40, 40, 0, 0], C.sea);
    // Soft circles behind Pong.
    ctx.fillStyle = C.seaDeep;
    ctx.beginPath();
    ctx.arc(cardR - 150, PAD + headerH - 40, 190, 0, Math.PI * 2);
    ctx.save();
    ctx.clip(new Path2D(`M${cardL} ${PAD} H${cardR} V${PAD + headerH} H${cardL} Z`));
    ctx.fill();
    ctx.restore();
  }
  let y = PAD + 64;
  text(r.kicker, left, y, `800 26px ${f.body}`, C.seaText);
  y += 44;
  for (const line of titleLines) {
    y += 66;
    text(line, left, y, `600 68px ${f.display}`, "#ffffff");
    y += 10;
  }
  y += 44;
  text(r.subtitle, left, y, `700 28px ${f.body}`, C.seaText);

  // Speech bubble over Pong.
  ctx.font = `600 30px ${f.display}`;
  const bubbleW = ctx.measureText(r.bubble).width + 56;
  const bubbleX = Math.min(right - bubbleW, cardR - PONG - 10);
  if (draw) {
    fillRound(ctx, bubbleX, bubbleTop, bubbleW, 64, 32, C.card);
    ctx.beginPath();
    ctx.moveTo(bubbleX + bubbleW - 70, bubbleTop + 60);
    ctx.lineTo(bubbleX + bubbleW - 40, bubbleTop + 92);
    ctx.lineTo(bubbleX + bubbleW - 36, bubbleTop + 60);
    ctx.fill();
  }
  text(r.bubble, bubbleX + 28, bubbleTop + 43, `600 30px ${f.display}`, C.sea);
  if (draw && pong) ctx.drawImage(pong, cardR - PONG - 20, PAD + headerH - PONG + 6, PONG, PONG);
  y = PAD + headerH + 12;

  // ── Sections.
  for (const section of r.sections) {
    if (section.heading) {
      y += 48;
      text(section.heading.toUpperCase(), left, y, `800 24px ${f.body}`, C.muted);
      y += 8;
    } else {
      y += 16;
    }
    for (const row of section.rows) {
      ctx.font = `600 40px ${f.display}`;
      const amountW = ctx.measureText(row.amount).width;
      ctx.font = `800 34px ${f.body}`;
      const labelLines = wrap(ctx, row.label, right - left - amountW - 40);
      const top = y;
      y += 56;
      text(row.amount, right, y, `600 40px ${f.display}`, row.tone === "paid" ? C.sea : C.ink, "right");
      labelLines.forEach((line, i) => {
        if (i) y += 44;
        text(line, left, y, `800 34px ${f.body}`, C.ink);
      });
      let detailsEnd = y;
      for (const detail of row.details.filter(Boolean)) {
        ctx.font = `600 26px ${f.body}`;
        for (const line of wrap(ctx, detail, right - left - (row.badge ? 220 : 0))) {
          detailsEnd += 38;
          text(line, left, detailsEnd, `600 26px ${f.body}`, C.muted);
        }
      }
      if (row.badge) {
        ctx.font = `800 22px ${f.body}`;
        const bw = ctx.measureText(row.badge).width + 32;
        const [bg, fg] = BADGE[row.tone ?? "open"];
        const by = top + 76;
        if (draw) fillRound(ctx, right - bw, by, bw, 40, 20, bg);
        text(row.badge, right - bw / 2, by + 28, `800 22px ${f.body}`, fg, "center");
        detailsEnd = Math.max(detailsEnd, by + 40 - 8);
      }
      y = detailsEnd + 28;
      if (draw) {
        ctx.fillStyle = C.line;
        ctx.fillRect(left, y, right - left, 2);
      }
    }
  }

  // ── Total: a dashed tear line, then a yellow block.
  y += 36;
  if (draw) {
    ctx.save();
    ctx.setLineDash([14, 12]);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cardL + 24, y);
    ctx.lineTo(cardR - 24, y);
    ctx.stroke();
    ctx.restore();
  }
  y += 36;
  const totalH = r.total.detail ? 150 : 116;
  if (draw) fillRound(ctx, left - 16, y, right - left + 32, totalH, 28, C.sunTint);
  text(r.total.label.toUpperCase(), left + 16, y + 62, `800 28px ${f.body}`, C.sunText);
  text(r.total.amount, right - 16, y + 80, `600 64px ${f.display}`, C.ink, "right");
  if (r.total.detail) text(r.total.detail, right - 16, y + 124, `700 24px ${f.body}`, C.sunText, "right");
  y += totalH;

  // ── Next payment or due date.
  if (r.note) {
    y += 24;
    if (draw) fillRound(ctx, left - 16, y, right - left + 32, 72, 24, r.note.late ? C.coralTint : C.seaTint);
    text(r.note.text, left + 16, y + 47, `800 28px ${f.body}`, r.note.late ? C.coral : C.sea);
    y += 72;
  }

  // ── Footer.
  y += 72;
  text(r.footer, left, y, `600 34px ${f.display}`, C.ink);
  text("Pong Money", right, y, `600 26px ${f.display}`, C.sea, "right");
  return y + 64;
}

/** The torn bottom edge of the receipt: a zigzag from right to left. */
function tornEdge(ctx: CanvasRenderingContext2D, bottom: number) {
  const tooth = 24;
  ctx.lineTo(W - PAD, bottom);
  for (let x = W - PAD; x > PAD; x -= tooth) {
    ctx.lineTo(x - tooth / 2, bottom + tooth / 2);
    ctx.lineTo(Math.max(PAD, x - tooth), bottom);
  }
}

/** Pong as an image to draw: his SVG, serialized. */
export function pongImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(PONG * 2));
  copy.setAttribute("height", String(PONG * 2));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't draw Pong"));
    img.src = url;
  });
}

/** The receipt as a PNG, with Pong when his image is given. */
export async function receiptPng(receipt: Receipt, pong: CanvasImageSource | null = null): Promise<Blob> {
  await document.fonts.ready;
  const measure = document.createElement("canvas").getContext("2d")!;
  const bottom = Math.ceil(layout(measure, receipt, pong, false));
  const height = bottom + 12 + PAD;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, W, height);
  // The card, with a soft shadow and a torn bottom edge.
  ctx.save();
  ctx.shadowColor = "rgba(18, 48, 42, 0.12)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.beginPath();
  ctx.moveTo(PAD, bottom);
  ctx.lineTo(PAD, PAD + 40);
  ctx.arcTo(PAD, PAD, PAD + 40, PAD, 40);
  ctx.lineTo(W - PAD - 40, PAD);
  ctx.arcTo(W - PAD, PAD, W - PAD, PAD + 40, 40);
  tornEdge(ctx, bottom);
  ctx.closePath();
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.restore();
  layout(ctx, receipt, pong, true);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the image"))), "image/png"),
  );
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The preview card when a Pong Money link is shared (Messenger, Facebook…).
export const alt = "Pong Money: financial helper app for paydays, bills and groceries";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const icon = await readFile(join(process.cwd(), "src/app/icon.svg"), "base64");
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 56,
        padding: "0 96px",
        background: "#13795A",
        color: "#F4FAF6",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/svg+xml;base64,${icon}`} width={280} height={280} alt="" />
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 96, fontWeight: 800 }}>Pong Money</div>
        <div style={{ fontSize: 40, maxWidth: 640 }}>
          Your financial helper for paydays, bills and groceries.
        </div>
      </div>
    </div>,
    size,
  );
}

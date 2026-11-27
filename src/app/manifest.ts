import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pong Money",
    short_name: "Pong Money",
    description: "Pong is a financial helper app for paydays, bills, utang and groceries.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    categories: ["finance", "productivity"],
    background_color: "#F4FAF6",
    theme_color: "#13795A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the app icon to jump straight in.
    shortcuts: [
      {
        name: "Input transaction",
        short_name: "Add",
        url: "/add",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Grocery mode",
        short_name: "Grocery",
        url: "/grocery",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      { name: "Plan", url: "/plan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

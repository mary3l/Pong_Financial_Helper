// Text for the public home page, and the structured data search engines read
// from it. The FAQ answers feed both, so what Google shows always matches the page.

import type { PongMood } from "@/components/pong";

export const TITLE = "Pong Money · Financial helper app for paydays, bills and groceries";

export const DESCRIPTION =
  "Pong is a free financial helper app for the Philippines: plan each kinsenas payday, see what's safe to spend, track bills, loans, utang and pautang, and compare grocery prices per ml or kg.";

/** The money worries Pong is made for, and what Pong does about each. */
export const WHY: readonly { mood: PongMood; worry: string; answer: string }[] = [
  {
    mood: "shocked",
    worry: "“Sweldo's gone before the next kinsenas.”",
    answer: "Pong splits your pay into a daily amount that lasts until payday.",
  },
  {
    mood: "worried",
    worry: "“Bills pop up out of nowhere.”",
    answer: "Pong lines up every bill against the pay that covers it, so nothing surprises you.",
  },
  {
    mood: "ask",
    worry: "“Who owes me again?”",
    answer: "Pong keeps your utang and pautang, so you don't have to remember.",
  },
];

export const FEATURES = [
  {
    title: "Safe to spend today",
    body: "Your payday, bills and savings turned into one number: what you can spend today.",
    tint: "bg-sea-tint",
    emoji: "💰",
  },
  {
    title: "Paydays and bills",
    body: "Kinsenas, monthly or weekly pay, with every due date matched to the pay that covers it.",
    tint: "bg-sun-tint",
    emoji: "📅",
  },
  {
    title: "Utang and pautang",
    body: "Who owes you, who you owe, split bills, and payments as they come in.",
    tint: "bg-plum-tint",
    emoji: "🤝",
  },
  {
    title: "Loans, credit cards and BNPL",
    body: "Every installment, and the day you'll be fully paid.",
    tint: "bg-coral-tint",
    emoji: "💳",
  },
  {
    title: "Grocery prices per ml or kg",
    body: "Find the better deal by unit price, and keep a running total as you shop.",
    tint: "bg-sky-tint",
    emoji: "🛒",
  },
  {
    title: "Wallets in one place",
    body: "Cash, bank, GCash and Maya side by side, with savings kept apart.",
    tint: "bg-mint",
    emoji: "👛",
  },
] as const;

export const FAQ = [
  {
    question: "Is Pong Money free?",
    answer: "Yes. Sign in with Google or your email and start budgeting. There's nothing to pay.",
  },
  {
    question: "Does it connect to my bank or GCash?",
    answer:
      "No. You add your spending and income yourself, so Pong never asks for your bank or e-wallet passwords.",
  },
  {
    question: "Who can see my money data?",
    answer:
      "Only you. Every record is tied to your account and the database refuses to show it to anyone else.",
  },
  {
    question: "Can I install it on my phone?",
    answer:
      "Yes. Open Pong Money in your phone's browser and choose Add to Home screen. It opens like an app, with shortcuts for adding a transaction and grocery mode.",
  },
  {
    question: "Does it work without signal?",
    answer:
      "It opens without signal, and when the connection drops it waits and saves again as soon as you're back online.",
  },
  {
    question: "Does it work with a kinsenas (15th and 30th) payday?",
    answer:
      "Yes. Pong is built around Philippine paydays: twice a month, monthly or weekly, with your deductions taken out first.",
  },
] as const;

/** schema.org data for the home page: what the app is, and its FAQ. */
export function structuredData(siteUrl: URL) {
  const url = new URL("/", siteUrl).href;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Pong Money",
      url,
      description: DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web, Android, iOS",
      inLanguage: "en-PH",
      offers: { "@type": "Offer", price: "0", priceCurrency: "PHP" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ];
}

/** JSON for a <script> tag, with `<` escaped so the text can't close the tag early. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

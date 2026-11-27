// Text for the public home page, and the structured data search engines read
// from it. The FAQ answers feed both, so what Google shows always matches the page.

export const TITLE = "Pong Money · Free budget app for paydays, bills and groceries";

export const DESCRIPTION =
  "Free budget tracker for the Philippines: plan each kinsenas payday, see what's safe to spend, track bills, loans, utang and pautang, and compare grocery prices per ml or kg.";

export const FEATURES = [
  {
    title: "Safe to spend today",
    body: "Pong takes your next payday, your bills and your savings into account and shows how much you can spend each day without coming up short.",
  },
  {
    title: "Paydays and bills",
    body: "Set your kinsenas or monthly payday, your deductions and your due dates. Pong lines up every bill against the pay that covers it.",
  },
  {
    title: "Utang and pautang",
    body: "Keep track of who owes you and who you owe, split bills with friends, and mark payments as they come in.",
  },
  {
    title: "Loans, credit cards and BNPL",
    body: "Add loans, credit cards and buy-now-pay-later plans to see each installment and when you'll be fully paid.",
  },
  {
    title: "Grocery prices per ml or kg",
    body: "Compare sizes and promos by unit price, and use grocery mode to keep a running total as you shop.",
  },
  {
    title: "Wallets in one place",
    body: "Cash, bank accounts and e-wallets like GCash and Maya side by side, with savings kept separate from spending money.",
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

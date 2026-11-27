import { describe, expect, it } from "vitest";
import { FAQ, jsonLd, structuredData } from "./content";

describe("home page structured data", () => {
  const data = JSON.parse(jsonLd(structuredData(new URL("https://pong.example"))));

  it("describes a free finance web app at the home address", () => {
    expect(data[0]).toMatchObject({
      "@type": "WebApplication",
      url: "https://pong.example/",
      applicationCategory: "FinanceApplication",
      offers: { price: "0", priceCurrency: "PHP" },
    });
  });

  it("lists the same questions and answers the page shows", () => {
    expect(data[1]["@type"]).toBe("FAQPage");
    expect(
      data[1].mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [
        q.name,
        q.acceptedAnswer.text,
      ]),
    ).toEqual(FAQ.map((f) => [f.question, f.answer]));
  });

  it("can't close its script tag early", () => {
    expect(jsonLd({ text: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});

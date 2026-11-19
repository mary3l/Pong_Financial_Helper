import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Accessibility (axe-core) on the main screens, signed in: WCAG 2.1 A and AA
// rules that can be checked automatically. A clean run doesn't mean fully
// accessible (keyboard flow and screen reader wording need a person), but a
// failure is always a real problem.
const PAGES = [
  { name: "Home", path: "/", ready: { role: "heading", name: "Wallets" } },
  { name: "Money", path: "/money", ready: { role: "heading", name: "Money" } },
  { name: "Plan", path: "/plan", ready: { role: "heading", name: "Plan" } },
  { name: "Add", path: "/add", ready: { role: "group", name: "Category" } },
] as const;

for (const { name, path, ready } of PAGES) {
  test(`${name} has no automatically detectable accessibility problems`, async ({ page }) => {
    await page.goto(path);
    await expect(
      page.getByRole(ready.role, { name: ready.name, exact: true }).first(),
    ).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // One readable line per problem: rule, impact, where.
    const problems = violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} at ${n.target.join(" ")}`),
    );
    expect(problems, `${name} (${path})`).toEqual([]);
  });
}

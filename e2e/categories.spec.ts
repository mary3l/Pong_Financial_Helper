import { expect, test } from "@playwright/test";
import { hydrated } from "./hydration";

// Your own categories: added in Settings › Categories, offered in Add. Nothing
// is saved in Add, so the smoke tests' ₱1,000 in Cash stays as it is.

test("a category added in Settings shows up in Add", async ({ page }, info) => {
  // Each browser has its own user; a name per run keeps reruns from clashing.
  const name = `Milk tea ${info.project.name === "chromium" ? "C" : "M"}${Date.now() % 1000}`;

  await page.goto("/settings/categories");
  await (await hydrated(page.getByRole("button", { name: "+ Add category" }))).click();
  const dialog = page.getByRole("dialog", { name: "Add category" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add category" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Your categories" })).toContainText(name);

  await page.goto("/add");
  await (await hydrated(page.getByLabel(/^Description/))).fill("Boba");
  const category = page.getByRole("group", { name: "Category" }).getByRole("button", { name });
  await category.click();
  await expect(category).toHaveAttribute("aria-pressed", "true");
  // With an amount typed, the only thing left is the wallet.
  await expect(async () => {
    for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("95");
    await expect(page.getByRole("button", { name: "Pick a wallet" })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass();
  await expect(page.getByRole("button", { name: "Pick a wallet" })).toBeDisabled();
});

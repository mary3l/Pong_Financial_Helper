import { expect, test } from "@playwright/test";
import { hydrated } from "./hydration";

// Smoke tests: the things someone does every week, end to end, in a real
// browser against the real app and a local Supabase. They share one user
// (signed in by auth.setup.ts, with ₱1,000 in Cash) and run in file order
// (one worker, not fully parallel). Not serial mode: a failure doesn't skip
// the tests after it, so one run reports every problem.

test("Home shows the wallet and its balance", async ({ page }) => {
  await page.goto("/");
  const wallets = page.getByRole("region", { name: "Wallets" });
  // The wallet is named "Cash" and its type label is also "Cash"; the name comes first.
  await expect(wallets.getByText("Cash", { exact: true }).first()).toBeVisible();
  await expect(wallets.getByText("₱1,000")).toBeVisible();
});

test("adding an expense takes it off the Home balance", async ({ page }) => {
  await page.goto("/add");
  await expect(page.getByRole("group", { name: "Category" })).toBeVisible();

  // Typed the way a computer user does: the form listens to the keyboard. It
  // starts listening a moment after the page draws, so keys typed too early are
  // lost: clear and retype until the amount shows.
  const save = page.getByRole("button", { name: "Enter ₱150" });
  await expect(async () => {
    for (let i = 0; i < 8; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("120+30");
    await expect(save).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await save.click();

  await expect(page).toHaveURL("/");
  const wallets = page.getByRole("region", { name: "Wallets" });
  await expect(wallets.getByText("₱850")).toBeVisible();
});

test("a bill added in Plan shows up on Plan › Payments", async ({ page }) => {
  await page.goto("/plan/scheduled");
  await (await hydrated(page.getByRole("button", { name: "+ Add expense" }))).click();

  const dialog = page.getByRole("dialog", { name: "Add expense" });
  await dialog.getByLabel("Name").fill("Internet");
  await dialog.getByLabel("Amount", { exact: true }).fill("1699");
  // One time, due a week from today (the form's default date).
  await dialog.getByRole("button", { name: "One time" }).click();
  await dialog.getByRole("button", { name: "Add expense" }).click();
  await expect(dialog).toBeHidden();

  await page.goto("/plan/payments");
  await expect(page.getByText("Internet").first()).toBeVisible();
});

test("saving payroll settings shows the cutoff", async ({ page }) => {
  await page.goto("/payroll");
  await (await hydrated(page.getByLabel("Daily rate"))).fill("1000");
  await (await hydrated(page.getByRole("button", { name: "Calculate my pay" }))).click();

  await expect(page.getByRole("navigation", { name: "Cutoffs" })).toBeVisible();
});

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { hydrated } from "./hydration";
import { signInLink } from "./mailpit";

// First-run setup, as a brand-new user: spending wallets, savings, what you
// owe, then payday. Its own user (not past setup like the others), signed in
// from scratch, so it doesn't touch the smoke tests' data.

test.use({ storageState: { cookies: [], origins: [] } });

test("setup asks for wallets, savings and what you owe before Home", async ({
  page,
  request,
}, info) => {
  const email = `e2e-onboarding-${info.project.name}@example.com`;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const old = list.users.find((u) => u.email === email);
  if (old) await admin.auth.admin.deleteUser(old.id);
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: "Newbie" },
  });
  if (created.error) throw created.error;

  await page.goto("/login");
  await (await hydrated(page.getByRole("button", { name: "Sign in with email" }))).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await signInLink(request, email));

  // Not set up yet: Home sends you to step 1.
  await expect(page).toHaveURL("/setup");
  await expect(page.getByText("STEP 1 OF 6")).toBeVisible();
  await (await hydrated(page.getByLabel("Cash", { exact: true }))).fill("5000");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page).toHaveURL("/setup/savings");
  await expect(page.getByRole("heading", { name: "Money you're saving" })).toBeVisible();
  await (await hydrated(page.getByLabel("Emergency Savings", { exact: true }))).fill("20000");
  await page.getByRole("button", { name: "Next" }).click();

  // Your pay: a government employee on ₱30,000 a month, cutoffs 1–15 and 16–end, paid the 15th and 30th.
  await expect(page).toHaveURL("/setup/pay");
  await (await hydrated(page.getByRole("textbox", { name: "Gross pay per month" }))).fill("30000");
  await expect(page.getByText("Gross pay · estimates")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // What the office takes: Pong's estimates, and the payday they leave.
  await expect(page).toHaveURL("/setup/deductions");
  const taken = page.getByRole("region", { name: "Taken from your pay" });
  await expect(taken.getByText("GSIS")).toBeVisible();
  await expect(taken.getByText("Withholding tax")).toBeVisible();
  // Half of ₱30,000 a payday, minus what's taken that payday.
  await expect(page.getByRole("region", { name: "Your next paydays" })).toContainText(
    /payday: ₱15,000 − ₱[\d,.]+ = ₱[\d,.]+/,
  );
  // GSIS from the payslip: ₱3,000 instead of the ₱2,700 estimate.
  await (await hydrated(page.getByRole("textbox", { name: /GSIS/ }))).fill("3000");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page).toHaveURL("/setup/credit");
  await expect(page.getByRole("heading", { name: "What you owe" })).toBeVisible();
  // Employees can have a loan taken from their salary.
  await (await hydrated(page.getByRole("button", { name: "+ Loan" }))).click();
  await expect(page.getByRole("button", { name: "Taken from my salary" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await (await hydrated(page.getByRole("button", { name: "+ Credit card or BNPL" }))).click();
  await page.getByLabel("You owe on it now").fill("1500");
  await page.getByRole("button", { name: "Add credit line" }).click();
  const owed = page.getByRole("region", { name: "What you owe so far" });
  await expect(owed.getByText("SPayLater")).toBeVisible();
  await expect(owed.getByText("₱1,500")).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();

  // Bills: payday is already set from Your pay.
  await expect(page).toHaveURL("/setup/payday");
  await expect(page.getByRole("heading", { name: "Regular bills", level: 1 })).toBeVisible();
  await (await hydrated(page.getByRole("button", { name: "Skip for now" }))).click();

  // Home: Cash is spending money; the emergency fund is set aside (out of the
  // weekly pool), and the credit line isn't a wallet.
  await expect(page).toHaveURL("/");
  const wallets = page.getByRole("region", { name: "Wallets" });
  await expect(wallets.getByText("₱5,000")).toBeVisible();
  await expect(wallets.getByText("Bank · Emergency fund")).toBeVisible();
  await expect(wallets.getByText("SPayLater")).toBeHidden();

  // Money › Pay: the next payday's take-home, gross minus what's taken.
  await page.goto("/money");
  await expect(page.getByRole("link", { name: /Pay .*taken/ })).toBeVisible();

  // Pay: the typed GSIS is still GSIS (it can go back to the estimate), and
  // tax is worked out after it: (₱30,000 − ₱3,000 − ₱750 − ₱200) × 12, 15% over ₱250,000, ÷ 12.
  await page.goto("/payroll");
  await expect(page.getByRole("button", { name: "Use estimate" })).toHaveCount(1);
  await expect(page.getByText("₱782.50")).toBeVisible();
});

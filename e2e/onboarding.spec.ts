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
  await expect(page.getByText("STEP 1 OF 4")).toBeVisible();
  await (await hydrated(page.getByLabel("Cash", { exact: true }))).fill("5000");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page).toHaveURL("/setup/savings");
  await expect(page.getByRole("heading", { name: "Money you're saving" })).toBeVisible();
  await (await hydrated(page.getByLabel("Emergency fund", { exact: true }))).fill("20000");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page).toHaveURL("/setup/credit");
  await expect(page.getByRole("heading", { name: "What you owe" })).toBeVisible();
  await (await hydrated(page.getByRole("button", { name: "+ BNPL or credit line" }))).click();
  await page.getByLabel("You owe on it now").fill("1500");
  await page.getByRole("button", { name: "Add credit line" }).click();
  const owed = page.getByRole("region", { name: "What you owe so far" });
  await expect(owed.getByText("SPayLater")).toBeVisible();
  await expect(owed.getByText("₱1,500")).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();

  await expect(page).toHaveURL("/setup/payday");
  await (await hydrated(page.getByRole("button", { name: "Skip for now" }))).click();

  // Home: Cash is spending money; the emergency fund is set aside (out of the
  // weekly pool), and the credit line isn't a wallet.
  await expect(page).toHaveURL("/");
  const wallets = page.getByRole("region", { name: "Wallets" });
  await expect(wallets.getByText("₱5,000")).toBeVisible();
  await expect(wallets.getByText("Bank · Emergency fund")).toBeVisible();
  await expect(wallets.getByText("SPayLater")).toBeHidden();
});

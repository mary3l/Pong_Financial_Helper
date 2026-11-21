import { expect, test as setup } from "@playwright/test";
import { signInLink } from "./mailpit";

// Signs in the way a person does: email → sign-in link from the inbox →
// back in the app, signed in. The local Supabase delivers email to its test
// inbox (Mailpit), which we read over its API. The browser's signed-in state
// is saved, so the other tests start signed in.

setup("sign in with an email link", async ({ page, request }) => {
  const { email, storageState } = setup.info().project.metadata as {
    email: string;
    storageState: string;
  };

  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with email" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  await page.goto(await signInLink(request, email));

  // Home, signed in, with the wallet global-setup made. "/" resolves against
  // baseURL, so the host is set in one place (playwright.config.ts).
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Wallets" })).toBeVisible();

  await page.context().storageState({ path: storageState });
});

import { expect, test as setup, type APIRequestContext } from "@playwright/test";

// Signs in the way a person does: email → sign-in link from the inbox →
// back in the app, signed in. The local Supabase delivers email to its test
// inbox (Mailpit), which we read over its API. The browser's signed-in state
// is saved, so the other tests start signed in.

/** The newest sign-in link Mailpit holds for `email`. */
async function signInLink(request: APIRequestContext, email: string): Promise<string> {
  const mailpit = process.env.MAILPIT_URL;
  let link = "";
  await expect
    .poll(
      async () => {
        const search = await request.get(`${mailpit}/api/v1/search`, {
          params: { query: `to:"${email}"` },
        });
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        if (!messages?.length) return "";
        const message = await request.get(`${mailpit}/api/v1/message/${messages[0].ID}`);
        const { HTML, Text } = (await message.json()) as { HTML: string; Text: string };
        link = (HTML + Text).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/)?.[0] ?? "";
        return link;
      },
      { message: `a sign-in email for ${email}`, timeout: 20_000 },
    )
    .not.toBe("");
  return link.replaceAll("&amp;", "&");
}

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

import { expect, type APIRequestContext } from "@playwright/test";

// The local Supabase delivers email to its test inbox (Mailpit), which the
// end-to-end tests read over its API to sign in the way a person does.

/** The newest sign-in link Mailpit holds for `email`. */
export async function signInLink(request: APIRequestContext, email: string): Promise<string> {
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

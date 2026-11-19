import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (QA Phase 5): the real app, built and started, against a
// LOCAL Supabase. Before `npm run e2e`:
//   npm run db:start   (local Supabase, with its test inbox)
//   npm run e2e:env    (writes .env.e2e with its URL and keys)
if (existsSync(".env.e2e")) process.loadEnvFile(".env.e2e");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(supabaseUrl)) {
  throw new Error(
    "End-to-end tests only run against a local Supabase. Run `npm run db:start`, then `npm run e2e:env`.",
  );
}

// 127.0.0.1, not localhost: it's the local Supabase's site_url, so sign-in links come back here.
const baseURL = "http://127.0.0.1:3000";

/** A browser project with its own test user, signed in once by auth.setup.ts. */
function browser(name: string, device: (typeof devices)[string], email: string) {
  const storageState = `e2e/.auth/${name}.json`;
  return [
    {
      name: `${name} sign-in`,
      testMatch: /auth\.setup\.ts/,
      use: { ...device },
      metadata: { email, storageState },
    },
    {
      name,
      testIgnore: /auth\.setup\.ts/,
      dependencies: [`${name} sign-in`],
      use: { ...device, storageState },
      metadata: { email, storageState },
    },
  ];
}

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Each browser's tests share one user and run in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries: the smoke flow builds on its own data, so a rerun would start mid-story.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    ...browser("chromium", devices["Desktop Chrome"], "e2e-chromium@example.com"),
    ...browser("mobile-safari", devices["iPhone 13"], "e2e-mobile@example.com"),
  ],
  webServer: {
    // A production build, as users get it. Env from .env.e2e overrides .env.local.
    command: "npm run build && npm run start",
    url: baseURL,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});

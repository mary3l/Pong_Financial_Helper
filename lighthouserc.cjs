// Lighthouse CI (QA Phase 5): performance and accessibility scores for the
// main screens, signed in. Run after `npm run e2e`, which builds the app and
// saves a signed-in session in e2e/.auth/chromium.json:
//
//   npm run lighthouse
//
// Fails below 80 for performance or 90 for accessibility. Reports land in
// .lighthouseci/ (open the .html files).
const { readFileSync } = require("node:fs");

const SESSION = "e2e/.auth/chromium.json";

function sessionCookie() {
  try {
    const { cookies } = JSON.parse(readFileSync(SESSION, "utf8"));
    return cookies
      .filter((c) => c.domain === "127.0.0.1")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    throw new Error(`No signed-in session in ${SESSION}. Run \`npm run e2e\` first.`);
  }
}

const base = "http://127.0.0.1:3000";

module.exports = {
  ci: {
    collect: {
      // The production build `npm run e2e` made.
      startServerCommand: "npm run start",
      startServerReadyPattern: "Ready",
      url: [`${base}/`, `${base}/money`, `${base}/plan`, `${base}/add`],
      numberOfRuns: 3,
      settings: {
        extraHeaders: { Cookie: sessionCookie() },
        chromeFlags: "--no-sandbox",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.8, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 0.9, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci" },
  },
};

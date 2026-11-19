// Writes .env.e2e with the LOCAL Supabase's URL and keys, for the
// end-to-end tests (QA Phase 5). Run after `npm run db:start`:
//
//   npm run e2e:env
//
// It reads `supabase status`, so it can only ever point at the Supabase on
// this machine, never your real project in .env.local.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let raw;
try {
  raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
} catch (e) {
  console.error(
    "Couldn't read `supabase status`. Is the local Supabase running? Try `npm run db:start`.",
  );
  console.error(String(e.stderr ?? e.message));
  process.exit(1);
}

const status = JSON.parse(raw.slice(raw.indexOf("{")));
const entries = Object.entries(status).filter(([, v]) => typeof v === "string");
const find = (test) => entries.find(([k, v]) => test(k, v))?.[1];

// Matched by value where we can, so a renamed field in a new CLI still works.
const values = {
  NEXT_PUBLIC_SUPABASE_URL:
    find((k) => /^API_URL$/i.test(k)) ?? find((_, v) => /:54321\/?$/.test(v)),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    find((_, v) => v.startsWith("sb_publishable_")) ?? find((k) => /^ANON_KEY$/i.test(k)),
  SUPABASE_SECRET_KEY:
    find((_, v) => v.startsWith("sb_secret_")) ?? find((k) => /^SERVICE_ROLE_KEY$/i.test(k)),
  MAILPIT_URL:
    find((k) => /MAILPIT|INBUCKET/i.test(k) && /URL/i.test(k)) ?? "http://127.0.0.1:54324",
};

const missing = Object.entries(values).filter(([, v]) => !v);
if (missing.length) {
  console.error(`Missing from \`supabase status\`: ${missing.map(([k]) => k).join(", ")}`);
  console.error(`It printed: ${entries.map(([k]) => k).join(", ")}`);
  process.exit(1);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(values.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error(`Refusing: ${values.NEXT_PUBLIC_SUPABASE_URL} isn't a local Supabase.`);
  process.exit(1);
}

writeFileSync(
  ".env.e2e",
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
);
console.log(
  `Wrote .env.e2e for ${values.NEXT_PUBLIC_SUPABASE_URL} (from: ${entries.map(([k]) => k).join(", ")})`,
);

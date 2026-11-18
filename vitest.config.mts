import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the pure money rules in src/lib. Run with `npm test`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/supabase/**"],
      reporter: ["text", "html", "lcov"],
      // Floors set at the measured baseline (2026-11-18) so coverage can't drop.
      // Target is 80% lines / 75% branches; raise these as tests are added.
      thresholds: { lines: 71, statements: 71, functions: 85, branches: 85 },
    },
  },
});

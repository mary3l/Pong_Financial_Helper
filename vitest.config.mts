import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `npm test` runs two projects:
// - unit: money rules (src/lib) and Server Actions (src/app), in Node.
// - dom: React components (*.test.tsx), in jsdom with Testing Library.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./src/test/setup-node.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup-dom.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      // data.ts is the Supabase read layer: only a real database exercises it
      // (QA Phase 4/5). It only showed up here once components imported it.
      exclude: ["src/lib/**/*.test.ts", "src/lib/supabase/**", "src/lib/data.ts"],
      reporter: ["text", "html", "lcov"],
      // Floors just under the measured baseline so coverage can't drop. Raise as
      // tests are added. Re-measured 2026-11-20 on Vitest 5 (91.4% lines, 89.5%
      // statements, 91.1% functions, 83.8% branches): since Vitest 4 the v8
      // provider maps coverage to the source more strictly, so the same tests
      // score lower than Vitest 3's 93/93/92.8/89.
      thresholds: { lines: 91, statements: 89, functions: 91, branches: 83 },
    },
  },
});

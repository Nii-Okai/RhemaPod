import { fileURLToPath } from "node:url";

import { defineConfig, configDefaults } from "vitest/config";

// `@` → the admin_portal root, so `@/lib/...` / `@/components/...` resolve the
// same way `tsconfig` "paths" does. Shared by both projects below.
const alias = {
  "@": fileURLToPath(new URL("./", import.meta.url)),
};

// Two test projects (plan Amendment A4 — `happy-dom` approved by Isaac at W6):
//
//   node — pure logic + MSW transport suites. Plan §A.11: assert on the wire,
//          never a mocked fetch; reducers assert on logic, not on render. No
//          DOM. These are the `*.test.{ts,tsx}` files EXCEPT `*.dom.test.*`.
//
//   dom  — component / hook render tests under happy-dom (Vitest's lighter
//          alternative to jsdom). These are the `*.dom.test.{ts,tsx}` files —
//          the DataTable interaction + a11y surface (roving focus, the
//          header⇄bulk-bar swap, keyboard selection) that was untestable
//          without a DOM.
export default defineConfig({
  test: {
    // Scheduler starvation of `findBy*` at the default fan-out: Vitest spins one
    // isolated worker per core (~30 here) and the heavier happy-dom interaction
    // suites then lose their own async races under CPU contention — flaky,
    // machine-dependent, nothing to do with the code under test (the base branch
    // fails ~3/5 full runs without this cap). Capping the pool keeps file
    // isolation intact while making the run deterministic. Drop to 1 if it
    // flakes again. (W9 — flagged in status.md)
    maxWorkers: 3,
    projects: [
      {
        extends: true,
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          exclude: [
            ...configDefaults.exclude,
            "tests/**/*.dom.test.ts",
            "tests/**/*.dom.test.tsx",
          ],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        resolve: { alias },
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["tests/**/*.dom.test.ts", "tests/**/*.dom.test.tsx"],
          setupFiles: ["./tests/setup.dom.ts"],
        },
      },
    ],
  },
  resolve: { alias },
});

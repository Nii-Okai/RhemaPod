import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The API-client suite is pure transport + error mapping exercised through MSW
// (plan §A.11 — assert on the wire, never a mocked fetch). It needs no DOM, so
// the default `node` environment is right; component/hook rendering arrives
// with the screens that need it (W7+).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});

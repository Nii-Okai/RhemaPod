import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/* W2 unit suite is pure logic (no DOM): StatusBadge pipeline mapping, Avatar
   name-hash determinism, SegmentedControl navigation, Pagination range. The
   node environment is deliberate — component rendering tests arrive with the
   work items that add stateful components (W4+). */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": root },
  },
});

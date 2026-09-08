import { defineConfig, devices } from "@playwright/test";

/**
 * One happy-path E2E suite against the local Docker stack (plan §A.11,
 * resolved decision 2). Not wired into `npm run verify` — it needs the stack
 * and a seeded DB, which `verify` must not depend on.
 *
 * The dev server (not `next start`) is deliberate: `next start` forces
 * `NODE_ENV=production`, which makes the auth cookies `Secure`, and a `Secure`
 * cookie on `http://localhost` is silently dropped — login would just fail
 * (§A.8).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      API_BASE_URL: process.env.API_BASE_URL ?? "http://127.0.0.1:8000",
      PORTAL_ORIGIN: "http://localhost:3000",
    },
  },
});

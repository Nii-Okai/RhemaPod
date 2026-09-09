import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Playwright global setup (plan §A.11 / GATE 3 #8): the E2E suite runs against
 * the seeded local Docker stack, and `app/scripts/seed_dev.py` IS the fixture.
 *
 * This hook, in order:
 *   1. asserts the backend is up and `ready` (loud failure, not a mystery 500
 *      mid-test);
 *   2. best-effort runs the idempotent seed via `docker compose exec` — a no-op
 *      when the rows already exist, skipped with a warning when `docker` isn't
 *      on this process's PATH;
 *   3. proves the seed rows are actually present by logging a seeded account in
 *      against the API — if that fails, it stops the run with the one command
 *      needed to fix it.
 *
 * Prerequisite when step 2 is skipped: run the seed once yourself —
 *   docker compose exec -T api python -m app.scripts.seed_dev
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
// __dirname = admin_portal/tests/e2e → repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SEED_ACCOUNT = {
  email: "editor.sam@seed.rhemapod.dev",
  password: "SeedDev-Passphrase-2026",
};
const SEED_COMMAND = "docker compose exec -T api python -m app.scripts.seed_dev";

async function assertStackUp(): Promise<void> {
  let body: { status?: string; checks?: Record<string, string> };
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    body = (await res.json()) as typeof body;
    if (!res.ok) throw new Error(`health responded ${res.status}`);
  } catch (err) {
    throw new Error(
      `[e2e] Backend at ${API_BASE_URL} is not reachable. Bring the stack up:\n` +
        `        docker compose up -d\n` +
        `      (${(err as Error).message})`,
    );
  }
  if (body.status !== "ready") {
    throw new Error(
      `[e2e] Backend /health is "${body.status}", expected "ready" ` +
        `(${JSON.stringify(body.checks ?? {})}). Wait for the stack to settle.`,
    );
  }
}

function trySeed(): void {
  try {
    const out = execFileSync(
      "docker",
      ["compose", "exec", "-T", "api", "python", "-m", "app.scripts.seed_dev"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // Playwright may be launched from a shell whose PATH lacks the Docker
        // Desktop symlink dir; add the usual locations before giving up.
        env: {
          ...process.env,
          PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin`,
        },
      },
    );
    console.info(`[e2e] seed_dev:\n${out.trim()}`);
  } catch (err) {
    const first = (err as Error).message.split("\n")[0];
    console.warn(
      `[e2e] Could not run the seed automatically (${first}).\n` +
        `[e2e] Ensure it has been run once against the stack:\n` +
        `[e2e]   ${SEED_COMMAND}`,
    );
  }
}

async function assertSeedPresent(): Promise<void> {
  let status: number;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SEED_ACCOUNT),
    });
    status = res.status;
  } catch (err) {
    throw new Error(
      `[e2e] Could not reach the login endpoint to verify seed data: ` +
        `${(err as Error).message}`,
    );
  }
  if (status !== 200) {
    throw new Error(
      `[e2e] Seed account ${SEED_ACCOUNT.email} could not log in (HTTP ${status}). ` +
        `The Playwright fixture data is missing — run it once:\n` +
        `        ${SEED_COMMAND}`,
    );
  }
}

export default async function globalSetup(): Promise<void> {
  await assertStackUp();
  trySeed();
  await assertSeedPresent();
}

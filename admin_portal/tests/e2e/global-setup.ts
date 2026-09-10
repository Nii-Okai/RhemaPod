import { execFileSync } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { BOOTSTRAP_ADMIN, CREATE_ADMIN_COMMAND } from "./constants";

/**
 * Playwright global setup (plan §A.11 / GATE 3 #8): the E2E suite runs against
 * the seeded local Docker stack, and `app/scripts/seed_dev.py` IS the fixture.
 *
 * This hook, in order:
 *   1. asserts the backend is up and `ready` (loud failure, not a mystery 500
 *      mid-test);
 *   2. best-effort runs `seed_dev.py --fresh` via `docker compose exec` — drops
 *      and rebuilds exactly the seed-tagged rows (email domain / `[SEED]`
 *      prefix / `seed-` slug), so every run starts from a known dataset and the
 *      per-run `e2e.invite.<RUN_ID>@…` rows `users-lifecycle.spec.ts` leaves
 *      behind never accumulate. Skipped with a warning when `docker` isn't on
 *      this process's PATH;
 *   3. best-effort, idempotently creates the bootstrap admin
 *      (`admin@rhemapod.com`) the same way — `seed_dev.py` does NOT own it, but
 *      `users-lifecycle.spec.ts` steps 4–6 need it (a second `create_admin`
 *      run is a no-op that exits 0);
 *   4. proves both accounts are actually usable by logging each in against the
 *      API — a missing seed or bootstrap admin stops the run here, with the one
 *      command to fix it, instead of a 30s `waitForURL` timeout mid-test.
 *
 * The two `docker compose exec` calls (steps 2–3) run back-to-back and BEFORE
 * any verification fetch: `execFileSync` blocks the event loop for a second or
 * two while `--fresh` rebuilds, long enough to kill an idle keep-alive socket
 * undici would then try to reuse — so `apiLogin` also retries a thrown
 * connection error (never a real HTTP status).
 *
 * Prerequisite when steps 2/3 are skipped (no `docker` on PATH): run them once
 * yourself —
 *   docker compose exec -T api python -m app.scripts.seed_dev --fresh --force
 *   docker compose exec -T api python -m app.scripts.create_admin \
 *     --email admin@rhemapod.com --password 'AdminPass1@@'
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
// __dirname = admin_portal/tests/e2e → repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SEED_ACCOUNT = {
  email: "editor.sam@seed.rhemapod.dev",
  password: "SeedDev-Passphrase-2026",
};
const SEED_COMMAND =
  "docker compose exec -T api python -m app.scripts.seed_dev --fresh --force";

/** `docker compose exec -T api …` with the Docker Desktop symlink dir added to
 *  PATH (Playwright may be launched from a shell that lacks it). Throws on a
 *  non-zero exit or a missing `docker`. */
function dockerComposeExec(args: string[]): string {
  return execFileSync("docker", ["compose", "exec", "-T", "api", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin`,
    },
  });
}

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
    const out = dockerComposeExec([
      "python",
      "-m",
      "app.scripts.seed_dev",
      "--fresh",
      "--force",
    ]);
    console.info(`[e2e] seed_dev --fresh:\n${out.trim()}`);
  } catch (err) {
    const first = (err as Error).message.split("\n")[0];
    console.warn(
      `[e2e] Could not run the seed automatically (${first}).\n` +
        `[e2e] Ensure it has been run once against the stack:\n` +
        `[e2e]   ${SEED_COMMAND}`,
    );
  }
}

/**
 * The bootstrap admin is not a seed row — create it idempotently (a second run
 * is a no-op that exits 0; `create_admin.py`'s W16/W18 promote branch handles an
 * existing account). Best-effort: if `docker` isn't reachable, the login check
 * below fails loud with the fix command.
 */
function tryCreateBootstrapAdmin(): void {
  try {
    const out = dockerComposeExec([
      "python",
      "-m",
      "app.scripts.create_admin",
      "--email",
      BOOTSTRAP_ADMIN.email,
      "--password",
      BOOTSTRAP_ADMIN.password,
    ]);
    console.info(`[e2e] create_admin:\n${out.trim()}`);
  } catch (err) {
    const first = (err as Error).message.split("\n")[0];
    console.warn(
      `[e2e] Could not create the bootstrap admin automatically (${first}).\n` +
        `[e2e] If the next check fails, run:\n` +
        `[e2e]   ${CREATE_ADMIN_COMMAND}`,
    );
  }
}

/** POST /auth/login, returning the HTTP status. Retries a *thrown* error (a
 *  dead keep-alive socket after the blocking `docker` calls) up to 3 times;
 *  a real HTTP response — any status — is returned as-is. */
async function apiLogin(email: string, password: string): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return res.status;
    } catch (err) {
      lastErr = err;
      await sleep(300 * attempt);
    }
  }
  throw lastErr;
}

async function assertSeedPresent(): Promise<void> {
  let status: number;
  try {
    status = await apiLogin(SEED_ACCOUNT.email, SEED_ACCOUNT.password);
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

async function assertBootstrapAdmin(): Promise<void> {
  let status: number;
  try {
    status = await apiLogin(BOOTSTRAP_ADMIN.email, BOOTSTRAP_ADMIN.password);
  } catch (err) {
    throw new Error(
      `[e2e] Could not reach the login endpoint to verify the bootstrap admin: ` +
        `${(err as Error).message}`,
    );
  }
  if (status !== 200) {
    throw new Error(
      `[e2e] Bootstrap admin ${BOOTSTRAP_ADMIN.email} could not log in ` +
        `(HTTP ${status}). users-lifecycle.spec.ts steps 4–6 need it. Create it:\n` +
        `        ${CREATE_ADMIN_COMMAND}`,
    );
  }
}

export default async function globalSetup(): Promise<void> {
  await assertStackUp();
  trySeed();
  tryCreateBootstrapAdmin();
  await assertSeedPresent();
  await assertBootstrapAdmin();
}

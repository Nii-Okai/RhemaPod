import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * W14 money path (plan §A.11 — "the one thing unit tests structurally cannot
 * cover"): one sermon from creation to published, across the editor → manager
 * review boundary, against the seeded local Docker stack.
 *
 *   1. editor.sam creates a draft (real POST /sermons via the BFF; W8 autosave)
 *   2. media is uploaded through the real pipeline — client-validate → ticket →
 *      browser-direct PUT to MinIO → confirm → poll to `ready` (W9). MinIO is in
 *      the compose stack precisely so this leg runs for real.
 *   3. editor.sam submits for review           → status `pending_review`
 *   4. manager.mo approves & publishes (W10)   → status `published`
 *   5. the published sermon is visible in the public catalog
 *
 * One test, `workers: 1` — a single run stays far under the backend's 300/60s
 * global rate limit (GATE 3 #1, still pending). Accounts and the shared
 * passphrase come from `app/scripts/seed_dev.py`, which doubles as this
 * fixture (GATE 3 #8); `global-setup.ts` runs it and verifies it.
 */

const PASSWORD = "SeedDev-Passphrase-2026";
const EDITOR = "editor.sam@seed.rhemapod.dev";
const MANAGER = "manager.mo@seed.rhemapod.dev";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const FIXTURE_MP3 = path.join(__dirname, "fixtures", "tiny.mp3");

const SERMON_ID_RE = /\/sermons\/[0-9a-f-]{36}$/;

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function logout(page: Page): Promise<void> {
  // The real sidebar control (W5) — POSTs /api/auth/logout, then hard-navigates.
  await page.getByRole("button", { name: "Out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login");
}

/** Staff view of a sermon, read through the authenticated BFF as the page's
 *  current user. */
async function staffSermonStatus(page: Page, id: string): Promise<string | number> {
  return page.evaluate(async (sid) => {
    const res = await fetch(`/api/bff/sermons/${sid}`);
    if (!res.ok) return res.status;
    return ((await res.json()) as { status?: string }).status ?? "(no status)";
  }, id);
}

test("editor creates & uploads, manager reviews & publishes", async ({
  page,
  request,
}) => {
  const title = `E2E money path ${Date.now()}`;
  let sermonId = "";

  await test.step("editor.sam creates a draft sermon", async () => {
    await login(page, EDITOR);
    await page.goto("/sermons/new");

    await page.getByLabel("Title").fill(title);
    await page
      .getByLabel("Description")
      .fill("Created by the W14 Playwright money-path E2E.");
    // `selectOption` waits for the option to be present — covers the async
    // speakers/categories loads. Names are seed constants. `exact` because the
    // top-bar "Search sermons, series, speakers" box also matches "Speaker".
    await page
      .getByLabel("Speaker", { exact: true })
      .selectOption({ label: "[SEED] Pastor John Doe" });
    await page
      .getByLabel("Category", { exact: true })
      .selectOption({ label: "[SEED] Teaching" });

    // Autosave (W8): the first change with a non-empty title POSTs /sermons and
    // the editor rewrites the URL to /sermons/<id> via history.replaceState.
    await page.waitForURL(SERMON_ID_RE, { timeout: 20_000 });
    sermonId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(sermonId).toMatch(/^[0-9a-f-]{36}$/);

    // The draft persists — it comes back from GET /sermons filtered by title.
    await page.goto(`/sermons?q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });

  await test.step("media uploads through the real pipeline and reaches 'ready'", async () => {
    await page.goto(`/sermons/${sermonId}`);
    await expect(page.getByLabel("Title")).toHaveValue(title);

    // The Media card's hidden <input>; the accept attr disambiguates it from the
    // thumbnail image input. setInputFiles drives the same onChange the "Choose
    // file" button opens: validate → ticket → XHR PUT direct to MinIO → confirm.
    await page
      .locator('input[type="file"][accept*="video/mp4"]')
      .setInputFiles(FIXTURE_MP3);

    // The whole point of the suite: assert the job reaches READY, not merely
    // that the PUT returned. `transcode_inline` (dev) finalises on confirm, so
    // the poll flips the row to ready within a beat. If this times out, the PUT
    // to MinIO (CORS / presign host) or the confirm failed — check the retained
    // trace for a `[data-state="failed"]` row and its error text.
    const readyRow = page.locator(
      '[data-slot="upload-job"][data-state="ready"]',
    );
    await expect(readyRow).toBeVisible({ timeout: 45_000 });
    await expect(readyRow).toContainText("tiny.mp3");
  });

  await test.step("editor.sam submits for review", async () => {
    const submit = page.getByRole("button", { name: "Submit for review" });
    // Enabled only once autosave has settled (not dirty, not saving).
    await expect(submit).toBeEnabled({ timeout: 15_000 });
    await submit.click();

    await expect(
      page.getByText("This sermon is in review"),
    ).toBeVisible();
    await expect
      .poll(() => staffSermonStatus(page, sermonId), { timeout: 15_000 })
      .toBe("pending_review");
  });

  await test.step("manager.mo approves & publishes from the review queue", async () => {
    await logout(page);
    await login(page, MANAGER);
    await page.goto("/review");

    const card = page.locator("article", { hasText: title });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // W10: `approvePublish` runs approve then publish as two ordered calls.
    await card.getByRole("button", { name: "Approve & publish" }).click();

    await expect(page.getByText("Published to the app")).toBeVisible({
      timeout: 10_000,
    });
    await expect(card).toHaveCount(0); // left the queue
    await expect
      .poll(() => staffSermonStatus(page, sermonId), { timeout: 15_000 })
      .toBe("published");
  });

  await test.step("the sermon is live in the public catalog", async () => {
    // Hits the API host directly — no portal cookie is scoped to it, so this is
    // an anonymous read of the public catalog.
    const res = await request.get(
      `${API_BASE_URL}/api/v1/catalog/sermons/${sermonId}`,
    );
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { status?: string }).status).toBe("published");
  });
});

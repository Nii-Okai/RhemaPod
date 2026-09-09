import { AxeBuilder } from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Cookie,
  type Page,
  type TestInfo,
} from "@playwright/test";

/**
 * W14 automated accessibility sweep (plan §W14: "a11y sweep … grid semantics …").
 *
 * Runs `@axe-core/playwright` (dev dep, test-only — the standard axe binding for
 * Playwright) against every Phase 1 screen, logged in as `manager.mo` — the role
 * with the most surface (Community group + Review queue). `/login` is checked
 * logged out.
 *
 * Gate: **zero `serious` / `critical` violations** — this spec is allowed to fail
 * the suite on those, that is the point (plan §W14 acceptance). `moderate` and
 * `minor` findings are logged to the run output and attached to the report, not
 * failed on.
 *
 * `color-contrast` is split out into its own `test.fail()` case at the bottom.
 * The design's token palette is the source of truth for colour, and
 * `--color-ink-faint` (#9c9085 — "mono labels, meta, disabled text") sits at
 * ~2.8–3.1:1 on the warm grounds, below WCAG AA 1.4.3. That is a design-token
 * decision for Isaac (see the W14 a11y report, section c), not a fix this
 * branch makes — so the main sweep disables `color-contrast` and the dedicated
 * case documents the debt: it is EXPECTED to fail until the token is darkened,
 * at which point `test.fail()` flips it green and the marker comes off.
 *
 * Fixture: the seeded Docker stack (`app/scripts/seed_dev.py`, GATE 3 #8) — the
 * same fixture `money-path.spec.ts` uses; `global-setup.ts` runs and verifies
 * it. The seeded ids below are stable across re-seeds (deterministic UUIDs in
 * the seed script).
 */

const PASSWORD = "SeedDev-Passphrase-2026";
const MANAGER = "manager.mo@seed.rhemapod.dev";

// Seeded rows (deterministic — see app/scripts/seed_dev.py). A draft sermon so
// the editor renders in its editable state, and a seeded series for the
// episode-order panel.
const DRAFT_SERMON_ID = "2541fff9-9592-4339-a5ee-b80358f8b606";
const SERIES_ID = "f2699cc3-a15e-468c-aead-e85575a3b1a1";

const IMPACT_FAIL = new Set(["serious", "critical"]);

// One shared logged-in session for the whole authenticated block — the BFF's
// per-account login limiter is 10/60s, so a login per test would be fragile
// (and needless). `beforeAll` signs in once, captures the httpOnly auth cookies,
// and every authed test re-applies them to its fresh context before navigating.
let managerCookies: Cookie[] = [];

/** Run axe on the current page, split by impact, attach the full result. */
async function sweep(page: Page, testInfo: TestInfo, screen: string) {
  // Let client screens settle (React Query lists, hydration) before scanning.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();

  const blocking = results.violations.filter((v) => IMPACT_FAIL.has(v.impact ?? ""));
  const advisory = results.violations.filter((v) => !IMPACT_FAIL.has(v.impact ?? ""));

  const summarise = (v: (typeof results.violations)[number]) =>
    `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${
      v.nodes.length === 1 ? "" : "s"
    })\n` +
    v.nodes
      .slice(0, 4)
      .map((n) => `      - ${n.target.join(" ")}`)
      .join("\n");

  const lines = [
    `[a11y] ${screen} — ${results.violations.length} violation(s): ` +
      `${blocking.length} serious/critical, ${advisory.length} moderate/minor`,
    ...blocking.map(summarise),
    ...(advisory.length ? ["  --- advisory (not failed on) ---"] : []),
    ...advisory.map(summarise),
  ];
  const report = lines.join("\n");
  console.log(report);
  await testInfo.attach(`axe-${screen.replace(/\W+/g, "-")}.txt`, {
    body: report,
    contentType: "text/plain",
  });

  expect(
    blocking,
    `${screen}: ${blocking.length} serious/critical axe violation(s)\n${blocking
      .map(summarise)
      .join("\n")}`,
  ).toEqual([]);
}

test.describe("axe sweep — Phase 1 screens", () => {
  test("login (logged out)", async ({ page }, testInfo) => {
    await page.goto("/login");
    await sweep(page, testInfo, "login");
  });

  test.describe("authenticated (manager.mo)", () => {
    test.beforeAll(async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(MANAGER);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"));
      managerCookies = await ctx.cookies();
      await ctx.close();
      expect(
        managerCookies.some((c) => c.name === "rp_at" || c.name === "rp_rt"),
        "beforeAll: expected the BFF to set the auth cookies on login",
      ).toBe(true);
    });

    test.beforeEach(async ({ context }: { context: BrowserContext }) => {
      await context.addCookies(managerCookies);
    });

    test("sermons list", async ({ page }, testInfo) => {
      await page.goto("/sermons");
      await expect(page.getByRole("heading", { name: "Sermons" })).toBeVisible();
      await sweep(page, testInfo, "sermons");
    });

    test("sermon editor (new)", async ({ page }, testInfo) => {
      await page.goto("/sermons/new");
      await expect(page.getByLabel("Title")).toBeVisible();
      await sweep(page, testInfo, "sermons-new");
    });

    test("sermon detail (draft)", async ({ page }, testInfo) => {
      await page.goto(`/sermons/${DRAFT_SERMON_ID}`);
      await expect(page.getByLabel("Title")).toBeVisible();
      await sweep(page, testInfo, "sermons-detail");
    });

    test("series list", async ({ page }, testInfo) => {
      await page.goto("/series");
      await expect(page.getByRole("heading", { name: "Series" })).toBeVisible();
      await sweep(page, testInfo, "series");
    });

    test("series detail (episode order)", async ({ page }, testInfo) => {
      await page.goto(`/series/${SERIES_ID}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sweep(page, testInfo, "series-detail");
    });

    test("review queue", async ({ page }, testInfo) => {
      await page.goto("/review");
      await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
      await sweep(page, testInfo, "review");
    });

    test("people (speakers & categories)", async ({ page }, testInfo) => {
      await page.goto("/people");
      await expect(
        page.getByRole("heading", { name: "Speakers & categories" }),
      ).toBeVisible();
      await sweep(page, testInfo, "people");
    });

    test("announcements", async ({ page }, testInfo) => {
      await page.goto("/announcements");
      await expect(
        page.getByRole("heading", { name: "Announcements" }),
      ).toBeVisible();
      await sweep(page, testInfo, "announcements");
    });

    test("settings (stub)", async ({ page }, testInfo) => {
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await sweep(page, testInfo, "settings");
    });

    // DESIGN-TOKEN DEBT — expected-fail until `--color-ink-faint` is darkened
    // (W14 a11y report §c proposes #776a58, ≥4.5:1 on white/sunken/canvas/
    // clay-50). `test.fail()`: green here means the token was fixed — drop this
    // marker and re-fold `color-contrast` into the main sweep. Runs on the
    // sermons list because it is the densest `text-ink-faint` surface (mono
    // header labels + footer range text + row meta).
    test("color-contrast (WCAG 1.4.3) — sermons list", async ({ page }, testInfo) => {
      test.fail(); // documented design-token debt — see the block comment above
      await page.goto("/sermons");
      await expect(page.getByRole("heading", { name: "Sermons" })).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa"])
        .withRules(["color-contrast"])
        .analyze();

      const nodes = results.violations.flatMap((v) => v.nodes);
      const report =
        `[a11y] sermons color-contrast — ${nodes.length} failing node(s):\n` +
        nodes
          .slice(0, 12)
          .map((n) => `  - ${n.target.join(" ")}\n    ${n.failureSummary?.split("\n").join(" ")}`)
          .join("\n");
      console.log(report);
      await testInfo.attach("axe-color-contrast-sermons.txt", {
        body: report,
        contentType: "text/plain",
      });

      expect(results.violations, report).toEqual([]);
    });
  });
});

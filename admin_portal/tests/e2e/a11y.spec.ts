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
const EDITOR = "editor.sam@seed.rhemapod.dev";

// A seeded draft sermon (so the editor renders in its editable state) and a
// seeded series (for the episode-order panel), located by their stable `[SEED]`
// titles. `seed_dev.py` assigns sermons/series RANDOM UUIDs — not deterministic
// ones — so the ids are resolved at run time in `beforeAll` (against the
// authenticated BFF) rather than hardcoded; hardcoded constants here silently
// rotted and broke the moment `seed_dev.py --fresh` ran (W24).
const DRAFT_SERMON_TITLE = "[SEED] Draft: On Mercy";
const SEED_SERIES_TITLE = "[SEED] Walking in Faith";
let draftSermonId = "";
let seedSeriesId = "";

const IMPACT_FAIL = new Set(["serious", "critical"]);

// One shared logged-in session for the whole authenticated block — the BFF's
// per-account login limiter is 10/60s, so a login per test would be fragile
// (and needless). `beforeAll` signs in once, captures the httpOnly auth cookies,
// and every authed test re-applies them to its fresh context before navigating.
let managerCookies: Cookie[] = [];

/** Sign an account in through the real login form and return its httpOnly auth
 *  cookies — the Phase 2 block logs in two roles (manager + editor) and applies
 *  the right set per test, so it cannot lean on the single shared `beforeEach`
 *  the Phase 1 block uses. */
async function loginCookies(
  browser: import("@playwright/test").Browser,
  baseURL: string | undefined,
  email: string,
): Promise<Cookie[]> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  const cookies = await ctx.cookies();
  await ctx.close();
  expect(
    cookies.some((c) => c.name === "rp_at" || c.name === "rp_rt"),
    `loginCookies(${email}): expected the BFF to set the auth cookies`,
  ).toBe(true);
  return cookies;
}

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

      // Resolve the seeded detail-view ids by their stable `[SEED]` titles,
      // through the now-authenticated BFF — before closing the context.
      draftSermonId = await page.evaluate(async (title) => {
        const r = await fetch(
          `/api/bff/sermons?q=${encodeURIComponent(title)}&limit=50`,
        );
        const j = (await r.json()) as { items?: { id: string; title: string }[] };
        return (j.items ?? []).find((s) => s.title === title)?.id ?? "";
      }, DRAFT_SERMON_TITLE);
      seedSeriesId = await page.evaluate(async (title) => {
        const r = await fetch(`/api/bff/series`);
        const j = (await r.json()) as { id: string; title: string }[];
        return (j ?? []).find((s) => s.title === title)?.id ?? "";
      }, SEED_SERIES_TITLE);

      await ctx.close();
      expect(
        managerCookies.some((c) => c.name === "rp_at" || c.name === "rp_rt"),
        "beforeAll: expected the BFF to set the auth cookies on login",
      ).toBe(true);
      expect(
        draftSermonId,
        `beforeAll: could not resolve the seeded "${DRAFT_SERMON_TITLE}" id`,
      ).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        seedSeriesId,
        `beforeAll: could not resolve the seeded "${SEED_SERIES_TITLE}" id`,
      ).toMatch(/^[0-9a-f-]{36}$/);
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
      await page.goto(`/sermons/${draftSermonId}`);
      await expect(page.getByLabel("Title")).toBeVisible();
      await sweep(page, testInfo, "sermons-detail");
    });

    test("series list", async ({ page }, testInfo) => {
      await page.goto("/series");
      await expect(page.getByRole("heading", { name: "Series" })).toBeVisible();
      await sweep(page, testInfo, "series");
    });

    test("series detail (episode order)", async ({ page }, testInfo) => {
      await page.goto(`/series/${seedSeriesId}`);
      await expect(
        page.getByRole("heading", { level: 1, name: SEED_SERIES_TITLE }),
      ).toBeVisible();
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

/* =============================================================================
   W24 — the three new Phase 2 screens at the same bar (plan §W24 deliverable 1).

   `@axe-core/playwright`, the same four WCAG tags as Phase 1, `color-contrast`
   split out (it stays the documented `--color-ink-faint` token debt, §W14 §c —
   NOT re-litigated here). Gate: zero `serious`/`critical`; `moderate`/`minor`
   logged and attached.

   Coverage:
     /dashboard  BOTH role variants — a manager session (greeting + WIP +
                 analytics blocks) AND an editor session (greeting + WIP only).
     /users      manager session; the seeded DEACTIVATED row (`editor.dana`,
                 W24 fixture) is on page 1, so the sweep covers a greyed row.
     /subscriptions  manager session; seeded `Past due` rows present.

   Plus the structural role-gating §W24 acceptance calls for and unit tests
   cannot reach: an editor's /dashboard makes ZERO `/admin/analytics/*`
   requests and renders no analytics DOM, and /users + /subscriptions 404 an
   editor.
   ========================================================================== */
test.describe("axe sweep — Phase 2 screens (W24)", () => {
  let mgrCookies: Cookie[] = [];
  let editorCookies: Cookie[] = [];

  test.beforeAll(async ({ browser, baseURL }) => {
    mgrCookies = await loginCookies(browser, baseURL, MANAGER);
    editorCookies = await loginCookies(browser, baseURL, EDITOR);
  });

  /** Fresh context with the given role's cookies applied. */
  async function pageAs(
    browser: import("@playwright/test").Browser,
    baseURL: string | undefined,
    cookies: Cookie[],
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ baseURL });
    await context.addCookies(cookies);
    const page = await context.newPage();
    return { context, page };
  }

  test("dashboard — manager variant (greeting + WIP + analytics)", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { context, page } = await pageAs(browser, baseURL, mgrCookies);
    try {
      await page.goto("/dashboard");
      await expect(
        page.getByRole("heading", { name: /Good morning/ }),
      ).toBeVisible();
      // The manager/admin-only blocks are in the tree for this variant.
      await expect(
        page.locator('[data-slot="dashboard-analytics"]'),
      ).toBeVisible();
      await sweep(page, testInfo, "dashboard-manager");
    } finally {
      await context.close();
    }
  });

  test("dashboard — editor variant (greeting + WIP only, no analytics)", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { context, page } = await pageAs(browser, baseURL, editorCookies);
    try {
      const analyticsRequests: string[] = [];
      page.on("request", (req) => {
        if (/\/admin\/analytics\//.test(req.url())) {
          analyticsRequests.push(`${req.method()} ${req.url()}`);
        }
      });

      await page.goto("/dashboard");
      await expect(
        page.getByRole("heading", { name: /Good morning/ }),
      ).toBeVisible();
      // Give a wrongly-queued analytics fetch its chance to fire before we
      // assert it never did. `networkidle` resolves the instant the network is
      // actually quiet (fast path) and is capped so the HMR socket under
      // `next dev` can't hang it — a bounded settle, not a fixed hard sleep.
      await page
        .waitForLoadState("networkidle", { timeout: 2_000 })
        .catch(() => {});

      // §A.1 / decision 1a: the analytics blocks are absent from the render
      // tree for an editor — not hidden, not placeholdered.
      await expect(
        page.locator('[data-slot="dashboard-analytics"]'),
      ).toHaveCount(0);
      expect(
        analyticsRequests,
        `editor /dashboard must issue zero /admin/analytics/* requests; saw:\n${analyticsRequests.join(
          "\n",
        )}`,
      ).toEqual([]);

      await sweep(page, testInfo, "dashboard-editor");
    } finally {
      await context.close();
    }
  });

  test("users (manager session, deactivated row on page 1)", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { context, page } = await pageAs(browser, baseURL, mgrCookies);
    try {
      await page.goto("/users");
      await expect(
        page.getByRole("heading", { name: "Users & roles" }),
      ).toBeVisible();
      // The W6 DataTable is non-interactive here → role="table" (W21 fix pass).
      await expect(
        page.getByRole("table", { name: "Staff accounts" }),
      ).toBeVisible();
      // The sweep must actually cover a greyed/deactivated row (W24 fixture).
      await expect(
        page
          .locator('[data-slot="user-state"][data-state="deactivated"]')
          .first(),
      ).toBeVisible();
      await sweep(page, testInfo, "users");
    } finally {
      await context.close();
    }
  });

  test("subscriptions (manager session)", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { context, page } = await pageAs(browser, baseURL, mgrCookies);
    try {
      await page.goto("/subscriptions");
      await expect(
        page.getByRole("heading", { name: "Subscriptions" }),
      ).toBeVisible();
      await expect(
        page.getByRole("table", { name: "Paying members" }),
      ).toBeVisible();
      await expect(
        page.locator('[data-slot="subscription-status"]').first(),
      ).toBeVisible();
      await sweep(page, testInfo, "subscriptions");
    } finally {
      await context.close();
    }
  });

  test("role-gating — an editor is refused /users and /subscriptions", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await pageAs(browser, baseURL, editorCookies);
    try {
      await page.goto("/users");
      await expect(
        page.getByRole("heading", { name: "Users & roles" }),
      ).toHaveCount(0);
      await expect(page.getByText(/404|not found/i).first()).toBeVisible();

      await page.goto("/subscriptions");
      await expect(
        page.getByRole("heading", { name: "Subscriptions" }),
      ).toHaveCount(0);
      await expect(page.getByText(/404|not found/i).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

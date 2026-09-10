import { expect, test, type Page } from "@playwright/test";

import { BOOTSTRAP_ADMIN } from "./constants";

/**
 * W24 — the Users lifecycle path, end to end against the seeded + W24-augmented
 * Docker stack (plan §W24 deliverable 2).
 *
 * One serial flow:
 *   1. INVITE       manager.mo invites a fresh editor from /users. The invite
 *                   email goes to the console backend; the set-password token is
 *                   recovered from the `POST /api/v1/users` response body, which
 *                   in a non-prod env carries `invite_link` (see
 *                   `app/api/admin_auth.py::create_staff`). This is the reliable
 *                   headless recovery — no inbox to scrape — and it is a real UI
 *                   invite, not an API shortcut: the dialog is filled and
 *                   submitted, we only READ the response the browser already
 *                   received.
 *   2. SET PASSWORD the Phase 1 W4 set-password screen, driven with the token →
 *                   the account gets a usable password and `activated_at` is
 *                   stamped server-side.
 *   3. SIGN IN      log out, log in as the new editor, land in the portal.
 *   4. CHANGE ROLE  an ADMIN session (`admin@rhemapod.com`) promotes the new
 *                   editor to manager (a manager may only assign `editor`, so
 *                   the promotion needs an admin). The row's Role cell updates.
 *   5. DEACTIVATE   the admin deactivates the new (now manager) user via the
 *                   `···` row menu → confirm dialog → the row shows the
 *                   "Deactivated" state.
 *   6. LAST-ADMIN   the minimum-one-active-admin invariant is enforced. See the
 *                   long note on that step for why this leg is driven through
 *                   the API rather than the row menu.
 *
 * `workers: 1` (playwright.config). A single run makes ~3 logins across 3
 * accounts and well under a hundred requests total — far inside the backend's
 * 300/60s global and 10/60s per-account limits.
 *
 * Fixture: the seeded stack (`global-setup.ts`) plus the W24 lifecycle-state
 * seed rows — `editor.dana@seed.rhemapod.dev` (deactivated) and
 * `admin.two@seed.rhemapod.dev` (a second active admin) — and the bootstrap
 * admin `admin@rhemapod.com`, which `global-setup.ts` now creates + verifies
 * idempotently (it is not a `seed_dev.py` row).
 *
 * Litter: step 1 creates `e2e.invite.<RUN_ID>@seed.rhemapod.dev` and there is
 * no user-delete endpoint to remove it. `global-setup.ts` runs
 * `seed_dev.py --fresh` before every suite run, which drops every
 * `@seed.rhemapod.dev` row (this invitee included) and rebuilds the fixture —
 * so the per-run invitees never accumulate. `--fresh` is the cleanup.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";

const SEED_PASSWORD = "SeedDev-Passphrase-2026";
const MANAGER = "manager.mo@seed.rhemapod.dev";

// The bootstrap admin (created + verified by `global-setup.ts`, not
// `seed_dev.py`). Credentials live in `./constants` so setup and spec can't drift.
const ADMIN_EMAIL = BOOTSTRAP_ADMIN.email;
const ADMIN_PASSWORD = BOOTSTRAP_ADMIN.password;
const SECOND_ADMIN = "admin.two@seed.rhemapod.dev";

// A fresh invitee per run, under the seed domain so `--fresh` collects it.
const RUN_ID = Date.now();
const NEW_EMAIL = `e2e.invite.${RUN_ID}@seed.rhemapod.dev`;
const NEW_NAME = "E2E Invitee";
const NEW_PASSWORD = "E2E-Lifecycle-Pass-2026"; // >= 12, mixed, not common

/**
 * Sign in from a clean state. Each `test()` in a `describe.serial` block runs in
 * its own fresh browser context (Playwright's default isolation), so there is
 * no prior session to log out of — a `goto("/login")` + submit is the whole
 * "log out, then log in as …" the flow calls for.
 */
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForLoginSettled(page, email);
}

/**
 * Success is a navigation away from `/login`. A bad, inactive, or rate-limited
 * credential otherwise just sits on `waitForURL` until the suite timeout with no
 * signal — so race the navigation against the login form's error `Alert` (401 →
 * "…don't match", 429 → "Too many sign-in attempts", 5xx → "Could not sign you
 * in") and throw with its text the moment it appears. The success path is
 * unchanged: a normal login navigates and returns before the error branch ever
 * resolves.
 */
async function waitForLoginSettled(page: Page, email: string): Promise<void> {
  const errorAlert = page
    .getByRole("alert")
    .filter({ hasText: /don't match|Too many sign-in|Could not sign you in/ });

  const navigated = page
    .waitForURL((url) => !url.pathname.startsWith("/login"))
    .then(() => ({ failed: false as const }));
  const failed = errorAlert
    .first()
    .waitFor({ state: "visible" })
    .then(async () => ({
      failed: true as const,
      text: (await errorAlert.first().innerText()).replace(/\s+/g, " ").trim(),
    }));

  // Whichever settles first wins; the loser's later rejection (its own timeout)
  // is swallowed so it can't surface as an unhandled rejection.
  const outcome = await Promise.race([navigated, failed]);
  navigated.catch(() => {});
  failed.catch(() => {});

  if (outcome.failed) {
    throw new Error(`login failed for ${email}: ${outcome.text}`);
  }
}

/** The staff row in the Users DataTable, keyed by user id (`data-rowkey`). */
function userRow(page: Page, userId: string) {
  return page.locator(`[role="row"][data-rowkey="${userId}"]`);
}

test.describe.serial("W24 — Users lifecycle (invite → activate → promote → deactivate)", () => {
  let newUserId = "";
  let inviteToken = "";

  test("1 · manager.mo invites a new editor from /users", async ({ page }) => {
    await login(page, MANAGER, SEED_PASSWORD);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users & roles" })).toBeVisible();

    await page.getByRole("button", { name: "Invite staff" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Invite a staff member")).toBeVisible();

    await dialog.getByLabel("Email").fill(NEW_EMAIL);
    await dialog.getByLabel("Full name (optional)").fill(NEW_NAME);
    // A manager can only assign `editor` — the role Select is present but has
    // the single option and is disabled (`roles.length <= 1` in
    // invite-staff-dialog).
    const inviteRole = dialog.getByLabel("Role", { exact: true });
    await expect(inviteRole).toHaveValue("editor");
    await expect(inviteRole).toBeDisabled();

    const invitePost = page.waitForResponse(
      (res) =>
        res.url().includes("/api/bff/users") &&
        res.request().method() === "POST" &&
        res.status() === 201,
    );
    await dialog.getByRole("button", { name: "Send invite" }).click();
    const body = (await (await invitePost).json()) as {
      user: { id: string; role: string; activated_at: string | null };
      invite_link: string;
    };

    newUserId = body.user.id;
    expect(newUserId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.role).toBe("editor");
    expect(body.user.activated_at).toBeNull();

    inviteToken =
      new URL(body.invite_link).searchParams.get("token") ?? "";
    expect(
      inviteToken.length,
      "invite_link in the create-staff response must carry a recoverable token",
    ).toBeGreaterThan(20);

    // The dialog closes and the new row lands in the list, invite pending.
    await expect(dialog).toBeHidden();
    const row = userRow(page, newUserId);
    await expect(row).toBeVisible();
    await expect(row.getByText(NEW_EMAIL)).toBeVisible();
    await expect(
      row.locator('[data-slot="user-state"]'),
    ).toHaveAttribute("data-state", "pending");
  });

  test("2 · the invite token sets a password (W4 set-password flow)", async ({
    page,
  }) => {
    expect(inviteToken, "step 1 must have recovered the invite token").not.toBe(
      "",
    );
    await page.goto(`/set-password?token=${inviteToken}`);
    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByLabel("Confirm password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set password" }).click();

    // reset-password returns a message, not a token pair — the form routes to
    // the sign-in screen with a success marker.
    await page.waitForURL((url) => url.pathname === "/login");
    expect(new URL(page.url()).searchParams.get("reset")).toBe("success");
  });

  test("3 · the new editor signs in and lands in the portal", async ({ page }) => {
    await login(page, NEW_EMAIL, NEW_PASSWORD);
    // A portal chrome control only a signed-in staff user sees.
    await expect(
      page.getByRole("button", { name: "Out", exact: true }),
    ).toBeVisible();
  });

  test("4 · an admin promotes the new editor to manager", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/users");
    const row = userRow(page, newUserId);
    await expect(row).toBeVisible();

    // The inline Role <select> is shown because an admin may reassign an
    // editor's role (RoleCell → assignableRoles).
    const roleSelect = row.getByLabel(`Role for ${NEW_NAME}`);
    await expect(roleSelect).toHaveValue("editor");

    // Assert the write actually landed server-side, not just the optimistic
    // client value — the BFF PATCH must return 2xx.
    const rolePatch = page.waitForResponse(
      (res) =>
        /\/api\/bff\/users\/[0-9a-f-]{36}\/role$/.test(res.url()) &&
        res.request().method() === "PATCH",
    );
    await roleSelect.selectOption("manager");
    expect((await rolePatch).ok()).toBe(true);

    // Optimistic write, then onSettled refetch — the cell settles on the new
    // role either way.
    await expect(roleSelect).toHaveValue("manager");
  });

  test("5 · the admin deactivates the new manager via the row menu", async ({
    page,
  }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/users");
    const row = userRow(page, newUserId);
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Deactivate this account?"),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Deactivate" }).click();

    await expect(dialog).toBeHidden();
    await expect(
      userRow(page, newUserId).locator('[data-slot="user-state"]'),
    ).toHaveAttribute("data-state", "deactivated");
  });

  /**
   * 6 · The minimum-one-active-admin invariant.
   *
   * Driven through the API, deliberately, and this is the documented leg:
   *
   * `_assert_not_last_active_admin` (auth_service) 409s only when the pending
   * change would leave ZERO active admins — i.e. the target is the sole active
   * admin at the moment of the call. Through the `/users` row menu that state
   * is unreachable in a single session: to act on another admin you must
   * yourself still be an active admin (so the target is never the last), and
   * the menu offers nothing on your own row (`actor.id === target.id → []`).
   * The row menu also hides "Deactivate" on any admin row once the loaded page
   * shows `activeAdminCount <= 1` (`row-menu-items.ts`) — the proactive client
   * gate. So the genuine backend 409 + its explanatory inline message are
   * covered where they are reachable: `tests/users/users-screen-lifecycle.dom.test.tsx`
   * ("a 409 last-admin renders an explanatory inline message …") and
   * `tests/users/row-menu-items.test.ts` ("hides Deactivate on the last active
   * admin row"). This leg proves the REAL invariant end to end against the
   * live backend, which an MSW test cannot.
   *
   * Sequence: deactivate `admin.two` (allowed, 200) → `admin@rhemapod.com` is
   * now the last active admin → attempt to deactivate it → 409 with the
   * "last active administrator" detail, account still active → reactivate
   * `admin.two` so the seed is left usable.
   */
  test("6 · the last active admin cannot be deactivated (API leg)", async ({
    request,
  }) => {
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    const accessToken = ((await loginRes.json()) as { access_token: string })
      .access_token;
    const auth = { Authorization: `Bearer ${accessToken}` };

    const listRes = await request.get(
      `${API_BASE_URL}/api/v1/users?role=admin`,
      { headers: auth },
    );
    expect(listRes.status()).toBe(200);
    const admins = ((await listRes.json()) as {
      items: { id: string; email: string; is_active: boolean }[];
    }).items;

    const self = admins.find((u) => u.email === ADMIN_EMAIL);
    const second = admins.find((u) => u.email === SECOND_ADMIN);
    expect(self, `${ADMIN_EMAIL} must be in the admin list`).toBeTruthy();
    expect(second, `${SECOND_ADMIN} (W24 seed fixture) must be in the admin list`).toBeTruthy();
    expect(self!.is_active).toBe(true);
    expect(second!.is_active).toBe(true);

    // Deactivating the second admin is allowed — one active admin remains.
    const deacSecond = await request.patch(
      `${API_BASE_URL}/api/v1/users/${second!.id}/active`,
      { headers: auth, data: { is_active: false } },
    );
    expect(deacSecond.status()).toBe(200);

    try {
      // Now the bootstrap admin is the last active admin — refuse, explain.
      const deacSelf = await request.patch(
        `${API_BASE_URL}/api/v1/users/${self!.id}/active`,
        { headers: auth, data: { is_active: false } },
      );
      expect(deacSelf.status()).toBe(409);
      const detail = ((await deacSelf.json()) as { detail: string }).detail;
      expect(detail).toMatch(/last active admin/i);

      // The account stayed active — the refusal was total, not partial.
      const recheck = await request.get(
        `${API_BASE_URL}/api/v1/users?role=admin`,
        { headers: auth },
      );
      const stillActive = ((await recheck.json()) as {
        items: { email: string; is_active: boolean }[];
      }).items.find((u) => u.email === ADMIN_EMAIL);
      expect(stillActive?.is_active).toBe(true);
    } finally {
      // Best-effort cleanup — errors swallowed. Reactivate the BOOTSTRAP admin
      // FIRST: if the invariant regressed, `deacSelf` returned 200 and the
      // assertion above threw before we reached here, leaving
      // `admin@rhemapod.com` deactivated — which would break every later run's
      // steps 4–6 as a login-timeout. It must come back even if the second
      // reactivate then fails. In the normal path `self` was never deactivated
      // and its PATCH is a harmless no-op.
      for (const id of [self!.id, second!.id]) {
        await request
          .patch(`${API_BASE_URL}/api/v1/users/${id}/active`, {
            headers: auth,
            data: { is_active: true },
          })
          .catch(() => {});
      }
    }
  });
});

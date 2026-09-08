import { expect, test } from "@playwright/test";

/**
 * W4 money path (plan §B W4 acceptance): log in as the seeded admin → land in
 * the portal → confirm the session is populated through the BFF proxy → log
 * out → back at /login. Exercises every W4 surface end to end: the login route
 * setting httpOnly cookies, the RSC `/auth/me` bootstrap, the authenticated
 * `/api/bff/*` pass-through, and logout clearing both cookies.
 *
 * A single run issues well under the backend's 300/60s global rate-limit
 * budget — GATE 3 #1 (the limiter keys on one IP behind the BFF) is still
 * pending and does not affect this test.
 */
const ADMIN_EMAIL = "admin@rhemapod.com";
const ADMIN_PASSWORD = "AdminPass1@@";

test("admin can sign in, reach the portal, and sign out", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Left /login for a portal route (/ redirects to /tokens in Phase 1).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  expect(new URL(page.url()).pathname).not.toBe("/login");

  // No auth token is readable by page JS.
  const cookieString = await page.evaluate(() => document.cookie);
  expect(cookieString).not.toContain("rp_at");
  expect(cookieString).not.toContain("rp_rt");

  // /auth/me is populated — through the authenticated BFF proxy.
  const me = await page.evaluate(async () => {
    const res = await fetch("/api/bff/auth/me");
    return { status: res.status, body: (await res.json()) as { email?: string } };
  });
  expect(me.status).toBe(200);
  expect(me.body.email).toBe(ADMIN_EMAIL);

  // Log out, then a portal route bounces back to /login.
  const logoutStatus = await page.evaluate(async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    return res.status;
  });
  expect(logoutStatus).toBe(200);

  await page.goto("/tokens");
  await page.waitForURL((url) => url.pathname === "/login");
  expect(new URL(page.url()).pathname).toBe("/login");
});

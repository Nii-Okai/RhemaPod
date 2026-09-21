import { beforeEach, describe, expect, it, vi } from "vitest";

/* review-fix batch, item 9 — Settings is now gated by `requireRole("manager")`
   like `/review`, `/users` and `/subscriptions` (it previously had none —
   "every role sees it" — which was wrong once the nav started hiding it from
   an Editor: the page itself must be the real gate, the nav hide is cosmetic
   only). Mirrors `tests/subscriptions/subscriptions-page.test.tsx`. */

const getServerUser = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("@/lib/auth/session", () => ({ getServerUser }));
vi.mock("next/navigation", () => ({ notFound }));

const { default: SettingsPage } = await import("@/app/(portal)/settings/page");

const session = (role: string) => ({
  id: "u-1",
  email: "x@rhemapod.church",
  name: "X",
  role,
});

beforeEach(() => {
  getServerUser.mockReset();
  notFound.mockClear();
});

describe("SettingsPage — requireRole('manager')", () => {
  it("404s an editor (notFound thrown, screen never returned)", async () => {
    getServerUser.mockResolvedValue(session("editor"));
    await expect(SettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("404s an anonymous request", async () => {
    getServerUser.mockResolvedValue(null);
    await expect(SettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the placeholder screen for a manager and an admin", async () => {
    getServerUser.mockResolvedValue(session("manager"));
    const manager = await SettingsPage();
    expect(manager).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();

    getServerUser.mockResolvedValue(session("admin"));
    const admin = await SettingsPage();
    expect(admin).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});

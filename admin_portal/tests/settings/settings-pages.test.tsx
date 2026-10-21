import { beforeEach, describe, expect, it, vi } from "vitest";

/* S17 — the Settings routes are thin Server Components gated by
   `requireRole`. Drives each async component directly: a manager 404s on
   /settings/audit (admin only, D7), the shell 404s an editor, and Reports
   passes `canExport` only for an admin (D1). `/settings` itself redirects to
   Profile. */

const getServerUser = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
const redirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  }),
);

vi.mock("@/lib/auth/session", () => ({ getServerUser }));
vi.mock("next/navigation", () => ({ notFound, redirect }));

const { default: SettingsLayout } = await import("@/app/(portal)/settings/layout");
const { default: SettingsIndex } = await import("@/app/(portal)/settings/page");
const { default: ProfilePage } = await import("@/app/(portal)/settings/profile/page");
const { default: AuditPage } = await import("@/app/(portal)/settings/audit/page");
const { default: ReportsPage } = await import("@/app/(portal)/settings/reports/page");
const { ProfileScreen } = await import("@/components/settings/profile-screen");
const { AuditScreen } = await import("@/components/settings/audit-screen");
const { ReportsScreen } = await import("@/components/settings/reports-screen");

const session = (role: string) => ({ id: "u-1", email: "x@rhemapod.church", name: "X", role });

type Element = { type: unknown; props: Record<string, unknown> };

beforeEach(() => {
  getServerUser.mockReset();
  notFound.mockClear();
  redirect.mockClear();
});

describe("Settings routes", () => {
  it("/settings redirects a manager to /settings/profile and 404s an editor", async () => {
    getServerUser.mockResolvedValue(session("manager"));
    await expect(SettingsIndex()).rejects.toThrow("NEXT_REDIRECT /settings/profile");
    getServerUser.mockResolvedValue(session("editor"));
    await expect(SettingsIndex()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the shell 404s an editor and an anonymous request", async () => {
    getServerUser.mockResolvedValue(session("editor"));
    await expect(SettingsLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
    getServerUser.mockResolvedValue(null);
    await expect(SettingsLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("Profile renders for a manager, 404s an editor", async () => {
    getServerUser.mockResolvedValue(session("manager"));
    expect(((await ProfilePage()) as Element).type).toBe(ProfileScreen);
    getServerUser.mockResolvedValue(session("editor"));
    await expect(ProfilePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("Audit trail 404s a manager and renders for an admin", async () => {
    getServerUser.mockResolvedValue(session("manager"));
    await expect(AuditPage()).rejects.toThrow("NEXT_NOT_FOUND");
    getServerUser.mockResolvedValue(session("admin"));
    expect(((await AuditPage()) as Element).type).toBe(AuditScreen);
  });

  it("Reports renders for a manager without export, and for an admin with it", async () => {
    getServerUser.mockResolvedValue(session("manager"));
    const asManager = (await ReportsPage()) as Element;
    expect(asManager.type).toBe(ReportsScreen);
    expect(asManager.props.canExport).toBe(false);

    getServerUser.mockResolvedValue(session("admin"));
    expect(((await ReportsPage()) as Element).props.canExport).toBe(true);

    getServerUser.mockResolvedValue(session("editor"));
    await expect(ReportsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

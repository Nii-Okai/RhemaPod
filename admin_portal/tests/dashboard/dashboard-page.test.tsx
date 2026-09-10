import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* W23 — the Dashboard role branch is SERVER-RESOLVED (plan §A.1 / decision 1a,
   §W23 acceptance: "no client-only guard"). This inspects the element the
   async Server Component returns — before any render, any effect — and asserts
   `showAnalytics` was decided from `getServerUser()`'s role. */

const getServerUser = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
);

vi.mock("@/lib/auth/session", () => ({ getServerUser }));
vi.mock("next/navigation", () => ({ redirect }));

// Imported after the mocks are registered.
const { default: DashboardPage } = await import(
  "@/app/(portal)/dashboard/page"
);
const { DashboardScreen } = await import(
  "@/components/dashboard/dashboard-screen"
);

const session = (role: string, name: string | null = "Ada Nwosu") => ({
  id: "u-1",
  email: "ada@rhemapod.church",
  name,
  role,
});

beforeEach(() => {
  getServerUser.mockReset();
  redirect.mockClear();
});

describe("DashboardPage — server-resolved variant", () => {
  it("renders <DashboardScreen> with showAnalytics=false for an editor", async () => {
    getServerUser.mockResolvedValue(session("editor"));
    const el = (await DashboardPage()) as React.ReactElement<{
      showAnalytics: boolean;
      firstName: string | null;
    }>;

    expect(el.type).toBe(DashboardScreen);
    expect(el.props.showAnalytics).toBe(false);
    expect(el.props.firstName).toBe("Ada");
  });

  it("sets showAnalytics=true for a manager and an admin", async () => {
    getServerUser.mockResolvedValue(session("manager"));
    expect(
      ((await DashboardPage()) as React.ReactElement<{ showAnalytics: boolean }>)
        .props.showAnalytics,
    ).toBe(true);

    getServerUser.mockResolvedValue(session("admin"));
    expect(
      ((await DashboardPage()) as React.ReactElement<{ showAnalytics: boolean }>)
        .props.showAnalytics,
    ).toBe(true);
  });

  it("passes firstName=null when the session has no name", async () => {
    getServerUser.mockResolvedValue(session("admin", null));
    expect(
      ((await DashboardPage()) as React.ReactElement<{
        firstName: string | null;
      }>).props.firstName,
    ).toBeNull();
  });

  it("redirects an anonymous request to /login and renders nothing", async () => {
    getServerUser.mockResolvedValue(null);
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

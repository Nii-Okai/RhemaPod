import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SessionProvider } from "@/lib/auth/session-context";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ProfileScreen } from "@/components/settings/profile-screen";
import { AuditScreen } from "@/components/settings/audit-screen";
import { ReportsScreen } from "@/components/settings/reports-screen";
import type { ChurchSettings } from "@/lib/query/hooks/use-church-settings";
import type { UsageReport } from "@/lib/query/hooks/use-usage-report";

/* S17 — the Settings screens, rendered (happy-dom), every backend call MSW.
   Covers the plan's named cases: a manager sees no Audit tab and no export
   control; the 409 reload-and-reapply banner; the staff-only default on the
   audit feed; and the "Data available from" notice. */

const nav = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  search: new URLSearchParams(),
  pathname: "/settings/profile",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: nav.replace,
    push: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
}));

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  server.resetHandlers();
  nav.replace.mockClear();
  nav.search = new URLSearchParams();
});
afterAll(() => server.close());

function renderWith(ui: React.ReactNode, role = "manager") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <SessionProvider user={{ id: "u-1", email: "m@x.dev", name: "Mo", role }}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SessionProvider>,
  );
}

const SETTINGS: ChurchSettings = {
  church_name: "Watered Garden Church",
  app_display_name: "RhemaPod",
  tagline: null,
  about: null,
  contact_email: "contact@rhemapod.com",
  contact_phone: null,
  website_url: null,
  address: null,
  comment_guidelines: "RhemaPod Comment Guidelines\n\nBe kind.",
  terms_of_use_url: null,
  privacy_policy_url: null,
  copyright_notice: null,
  version: 1,
  updated_at: "2026-10-20T09:00:00Z",
  updated_by: null,
};

/* --- tabs ------------------------------------------------------------- */

describe("SettingsTabs", () => {
  it("hides the Audit trail tab from a manager", () => {
    renderWith(<SettingsTabs />, "manager");
    expect(screen.getByRole("link", { name: "Profile" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reports" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Audit trail" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Data" })).toBeNull();
  });

  it("shows it to an admin and marks the current tab", () => {
    nav.pathname = "/settings/audit";
    renderWith(<SettingsTabs />, "admin");
    const audit = screen.getByRole("link", { name: "Audit trail" });
    expect(audit.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Data" })).toBeTruthy();
    nav.pathname = "/settings/profile";
  });
});

/* --- profile ---------------------------------------------------------- */

describe("ProfileScreen", () => {
  it("saves only the changed fields with the loaded version", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get("*/api/bff/admin/settings", () => HttpResponse.json(SETTINGS)),
      http.patch("*/api/bff/admin/settings", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({ ...SETTINGS, ...body, version: 2, updated_by: "m@x.dev" });
      }),
    );
    const user = userEvent.setup();
    renderWith(<ProfileScreen />);

    const tagline = await screen.findByLabelText("Tagline");
    await user.type(tagline, "Rooted in the Word");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Settings saved");
    expect(bodies).toEqual([{ version: 1, tagline: "Rooted in the Word" }]);
    expect(screen.getByText(/Last saved .* by m@x\.dev/)).toBeTruthy();
  });

  it("on 409 keeps the edits, shows the banner, and Load latest re-bases the form", async () => {
    let current = SETTINGS;
    server.use(
      http.get("*/api/bff/admin/settings", () => HttpResponse.json(current)),
      http.patch("*/api/bff/admin/settings", () =>
        HttpResponse.json(
          { detail: "These settings were changed by someone else.", correlation_id: "c" },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWith(<ProfileScreen />);

    const tagline = await screen.findByLabelText("Tagline");
    await user.type(tagline, "Mine");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Someone else saved these settings");
    expect((screen.getByLabelText("Tagline") as HTMLInputElement).value).toBe("Mine");
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    current = { ...SETTINGS, tagline: "Theirs", version: 2, updated_by: "other@x.dev" };
    await user.click(screen.getByRole("button", { name: "Load latest" }));

    await waitFor(() =>
      expect((screen.getByLabelText("Tagline") as HTMLInputElement).value).toBe("Theirs"),
    );
    expect(screen.queryByText("Someone else saved these settings")).toBeNull();
  });

  it("won't save with the contact email cleared", async () => {
    server.use(http.get("*/api/bff/admin/settings", () => HttpResponse.json(SETTINGS)));
    const user = userEvent.setup();
    renderWith(<ProfileScreen />);
    await user.clear(await screen.findByLabelText("Contact email"));
    expect(screen.getByText("Required")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/* --- audit ------------------------------------------------------------ */

const AUDIT_PAGE = {
  items: [
    {
      source: "audit_log",
      id: "a-1",
      created_at: "2026-10-20T08:15:00Z",
      action: "user.role_changed",
      outcome: "success",
      actor_id: "u-9",
      actor_label: "boss@example.com",
      actor_role: "admin",
      target_type: "user",
      target_id: "u-2",
      target_label: "ed@example.com",
      ip: "203.0.113.7",
      user_agent: "Mozilla/5.0",
      details: { from: "editor", to: "manager" },
      summary: "boss@example.com changed ed@example.com's role from editor to manager",
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

describe("AuditScreen", () => {
  it("asks for staff-only by default and offers it as a ticked filter", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get("*/api/bff/admin/audit", ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(AUDIT_PAGE);
      }),
    );
    const user = userEvent.setup();
    renderWith(<AuditScreen />, "admin");

    await screen.findByText(AUDIT_PAGE.items[0].summary);
    expect(queries[0].get("staff_only")).toBe("true");
    const box = screen.getByRole("checkbox", { name: "Staff actions only" }) as HTMLInputElement;
    expect(box.checked).toBe(true);

    await user.click(box);
    expect(nav.replace).toHaveBeenLastCalledWith("/settings/profile?staff=all", { scroll: false });
  });

  it("sends staff_only=false when the URL says staff=all", async () => {
    nav.search = new URLSearchParams("staff=all&category=auth");
    const queries: URLSearchParams[] = [];
    server.use(
      http.get("*/api/bff/admin/audit", ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ ...AUDIT_PAGE, items: [], total: 0 });
      }),
    );
    renderWith(<AuditScreen />, "admin");
    await screen.findByText("Nothing matches these filters");
    expect(queries[0].get("staff_only")).toBe("false");
    expect(queries[0].get("category")).toBe("auth");
  });

  it("opens a row's details with IP and browser", async () => {
    server.use(http.get("*/api/bff/admin/audit", () => HttpResponse.json(AUDIT_PAGE)));
    const user = userEvent.setup();
    renderWith(<AuditScreen />, "admin");
    await user.click(await screen.findByText(AUDIT_PAGE.items[0].summary));
    expect(await screen.findByText("203.0.113.7")).toBeTruthy();
    expect(screen.getByText("Mozilla/5.0")).toBeTruthy();
  });
});

/* --- reports ---------------------------------------------------------- */

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    period: { from: "2026-09-21", to: "2026-10-21", granularity: "day" },
    data_available_from: "2026-10-18",
    kpis: { plays: 42, completions: 7, watch_hours: 3.5, listeners: 9, new_listeners: 4, signups: 2 },
    series: [
      { start: "2026-10-18", end: "2026-10-19", plays: 20, completions: 3, watch_hours: 1.5, listeners: 5, new_listeners: 2, signups: 1 },
    ],
    top_sermons: [
      { sermon_id: "s-1", title: "Grace Abounds", plays: 30, completions: 5, watch_hours: 2 },
    ],
    ...over,
  };
}

describe("ReportsScreen", () => {
  it("shows the Data available from notice when the rollups start inside the period", async () => {
    server.use(http.get("*/api/bff/admin/analytics/report", () => HttpResponse.json(report())));
    renderWith(<ReportsScreen canExport={false} />);
    expect(await screen.findByText(/recorded from 18 October 2026/)).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("shows no notice when the rollups cover the whole period", async () => {
    server.use(
      http.get("*/api/bff/admin/analytics/report", () =>
        HttpResponse.json(report({ data_available_from: "2026-01-01" })),
      ),
    );
    renderWith(<ReportsScreen canExport={false} />);
    await screen.findByText("42");
    expect(screen.queryByText("Data available from")).toBeNull();
  });

  it("renders no export control for a manager", async () => {
    server.use(http.get("*/api/bff/admin/analytics/report", () => HttpResponse.json(report())));
    renderWith(<ReportsScreen canExport={false} />);
    await screen.findByText("42");
    expect(screen.queryByRole("link", { name: /CSV/ })).toBeNull();
  });

  it("gives an admin download links to the server's CSV", async () => {
    server.use(http.get("*/api/bff/admin/analytics/report", () => HttpResponse.json(report())));
    renderWith(<ReportsScreen canExport />, "admin");
    await screen.findByText("42");
    const link = screen.getByRole("link", { name: "Download CSV" });
    expect(link.getAttribute("href")).toMatch(
      /^\/api\/bff\/admin\/analytics\/report\/export\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&granularity=day&kind=timeseries$/,
    );
    expect(link.hasAttribute("download")).toBe(true);
    expect(screen.getByRole("link", { name: "Top sermons CSV" }).getAttribute("href")).toContain(
      "kind=top_sermons",
    );
  });
});

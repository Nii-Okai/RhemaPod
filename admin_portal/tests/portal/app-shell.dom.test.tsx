import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { AppShell } from "@/components/portal/app-shell";
import { navGroupsForRole } from "@/components/portal/nav-config";
import type { SessionUser } from "@/lib/auth/session-types";

/* W14 loose end — the <1100px nav drawer focus trap.

   The a11y pass already moved focus into the drawer on open and restored it on
   close. This proves the missing piece: while the drawer is open the rest of
   the shell (desktop rail + the main column that holds the top bar and page
   content) is rendered `inert`, so Tab cannot leave the panel and the page
   behind the scrim cannot be operated. Escape still closes it; `aria-expanded`
   on the hamburger still tracks state; focus still restores to the trigger.

   Every backend call is MSW, never a mocked fetch (§A.11). */

vi.mock("next/navigation", () => ({
  usePathname: () => "/sermons",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string | { toString(): string };
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : href.toString()} {...props}>
      {children}
    </a>
  ),
}));

const USER: SessionUser = {
  id: "u-1",
  email: "manager@rhemapod.com",
  name: "Morgan Reed",
  role: "manager",
};

function backend() {
  server.use(
    http.get("*/api/bff/sermons", () =>
      HttpResponse.json({ items: [], total: 4, limit: 1, offset: 0 }),
    ),
    http.get("*/api/bff/series", () => HttpResponse.json([{ id: "s" }])),
    http.get("*/api/bff/approvals/sermons/review-queue", () =>
      HttpResponse.json({ items: [], total: 2, limit: 1, offset: 0 }),
    ),
    http.get("*/api/bff/admin/comments", () =>
      HttpResponse.json({ items: [], total: 0, limit: 1, offset: 0 }),
    ),
  );
}

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AppShell user={USER} groups={navGroupsForRole(USER.role)}>
        <button type="button">page content button</button>
      </AppShell>
    </QueryClientProvider>,
  );
  const hamburger = screen.getByRole("button", { name: "Open navigation" });
  // The main column is the wrapper that holds the top bar (banner role).
  const mainColumn = screen.getByRole("banner").parentElement as HTMLElement;
  const desktopRail = view.container.querySelector(
    "div.sticky.top-0",
  ) as HTMLElement;
  return { view, hamburger, mainColumn, desktopRail };
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("AppShell — <1100px nav drawer focus trap", () => {
  it("does not inert the shell while the drawer is closed", async () => {
    backend();
    const { hamburger, mainColumn, desktopRail } = renderShell();

    // Let the sidebar nav-count probes settle so no MSW request outlives the test.
    expect(await screen.findByText("4")).toBeInTheDocument();

    expect(hamburger).toHaveAttribute("aria-expanded", "false");
    expect(mainColumn).not.toHaveAttribute("inert");
    expect(desktopRail).not.toHaveAttribute("inert");
    expect(
      screen.queryByRole("dialog", { name: "Portal navigation" }),
    ).not.toBeInTheDocument();
  });

  it("inerts the rest of the shell and moves focus into the drawer on open", async () => {
    const user = userEvent.setup();
    backend();
    const { hamburger, mainColumn, desktopRail } = renderShell();

    await user.click(hamburger);

    const dialog = await screen.findByRole("dialog", {
      name: "Portal navigation",
    });

    // Background is inert — Tab is trapped in the panel, the page behind the
    // scrim cannot be reached by keyboard, pointer or AT.
    expect(mainColumn).toHaveAttribute("inert");
    expect(desktopRail).toHaveAttribute("inert");
    expect(hamburger).toHaveAttribute("aria-expanded", "true");

    // Focus landed inside the drawer panel, on its "×" Close control (the
    // full-screen backdrop shares the aria-label, so scope to the panel id).
    const panel = document.getElementById("portal-nav-drawer") as HTMLElement;
    expect(dialog).toContainElement(panel);
    const close = within(panel).getByRole("button", {
      name: "Close navigation",
    });
    expect(close).toHaveFocus();

    // Every focusable in the page behind the drawer sits under an inert
    // ancestor — nothing there is in the tab order.
    const pageButton = screen.getByRole("button", {
      name: "page content button",
    });
    expect(pageButton.closest("[inert]")).toBe(mainColumn);
  });

  it("Escape closes the drawer, drops the inert, and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    backend();
    const { hamburger, mainColumn, desktopRail } = renderShell();

    await user.click(hamburger);
    await screen.findByRole("dialog", { name: "Portal navigation" });

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Portal navigation" }),
      ).not.toBeInTheDocument(),
    );

    expect(mainColumn).not.toHaveAttribute("inert");
    expect(desktopRail).not.toHaveAttribute("inert");
    expect(hamburger).toHaveAttribute("aria-expanded", "false");
    expect(hamburger).toHaveFocus();
  });
});

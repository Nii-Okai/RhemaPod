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
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SessionProvider } from "@/lib/auth/session-context";
import { UsersScreen } from "@/components/users/users-screen";
import type { UserPublic } from "@/lib/query/hooks/use-users";

/* W19 — the Users & roles lifecycle row actions, rendered (happy-dom). Every
   backend call is MSW, asserted on the wire (§A.11). Covers: the `···` menu
   gated by (role × target-role × state), the Deactivate confirmation dialog +
   `PATCH …/active` payload, the last-admin 409 rendered as an explanatory
   inline message (no toast, badge rolled back), the `revocation_deferred`
   note, the Resend-invite success + distinct 409/429/503 messages, and the
   State column text badge. */

const nav = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  push: vi.fn<(href: string) => void>(),
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: nav.replace,
    push: nav.push,
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/users",
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
  const w = window as unknown as { matchMedia?: unknown };
  w.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= () => {};
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
});
afterEach(() => {
  server.resetHandlers();
  nav.replace.mockClear();
  nav.push.mockClear();
  nav.search = new URLSearchParams();
});
afterAll(() => server.close());

/* --- fixtures ------------------------------------------------------- */

const ADMIN_SESSION = {
  id: "admin-1",
  email: "sam@rhemapod.church",
  name: "Sam Oke",
  role: "admin",
};
const MANAGER_SESSION = {
  id: "mgr-1",
  email: "meg@rhemapod.church",
  name: "Meg Ojo",
  role: "manager",
};

const user = (over: Partial<UserPublic>): UserPublic => ({
  id: "u-1",
  email: "u1@rhemapod.church",
  full_name: "User One",
  role: "editor",
  is_active: true,
  activated_at: "2025-02-01T00:00:00Z",
  created_at: "2024-06-21T10:00:00Z",
  ...over,
});

const EDITOR = user({
  id: "u-ed",
  email: "ada@rhemapod.church",
  full_name: "Ada Nwosu",
  role: "editor",
});
const MANAGER_ROW = user({
  id: "u-mgr",
  email: "dan@rhemapod.church",
  full_name: "Dan Okoye",
  role: "manager",
});
const ADMIN_LAST = user({
  id: "admin-9",
  email: "obi@rhemapod.church",
  full_name: "Obi Cole",
  role: "admin",
});
const EDITOR_OFF = user({
  id: "u-off",
  email: "eve@rhemapod.church",
  full_name: "Eve Duru",
  role: "editor",
  is_active: false,
});
const EDITOR_PENDING = user({
  id: "u-pend",
  email: "ivy@rhemapod.church",
  full_name: "Ivy Bassey",
  role: "editor",
  activated_at: null,
});

const COUNTS = { viewer: 4812, editor: 6, manager: 2, admin: 2, total: 4822 };

interface BackendOpts {
  rows?: UserPublic[];
  onActive?: (id: string, body: unknown) => void;
  activeError?: { status: number; detail?: string };
  activeResponse?: { revocation_deferred?: boolean };
  onResend?: (id: string) => void;
  resendError?: { status: number; detail?: string };
}

function backend(opts: BackendOpts = {}) {
  let rows: UserPublic[] = (opts.rows ?? [EDITOR, MANAGER_ROW]).map((r) => ({
    ...r,
  }));

  server.use(
    http.get("*/api/bff/users/role-counts", () => HttpResponse.json(COUNTS)),
    http.get("*/api/bff/users", ({ request }) => {
      const q = new URL(request.url).searchParams;
      const role = q.get("role");
      const filtered = role ? rows.filter((r) => r.role === role) : rows;
      return HttpResponse.json({
        items: filtered,
        total: filtered.length,
        limit: 25,
        offset: 0,
      });
    }),
    http.patch("*/api/bff/users/:id/active", async ({ params, request }) => {
      const body = await request.json();
      opts.onActive?.(String(params.id), body);
      await delay(20);
      if (opts.activeError) {
        return HttpResponse.json(
          {
            detail: opts.activeError.detail ?? "Rejected",
            correlation_id: "cid-a",
          },
          { status: opts.activeError.status },
        );
      }
      const isActive = (body as { is_active: boolean }).is_active;
      rows = rows.map((r) =>
        r.id === params.id ? { ...r, is_active: isActive } : r,
      );
      return HttpResponse.json({
        user: rows.find((r) => r.id === params.id),
        revocation_deferred: opts.activeResponse?.revocation_deferred ?? false,
      });
    }),
    http.post("*/api/bff/users/:id/resend-invite", async ({ params }) => {
      opts.onResend?.(String(params.id));
      await delay(20);
      if (opts.resendError) {
        return HttpResponse.json(
          {
            detail: opts.resendError.detail ?? undefined,
            correlation_id: "cid-r",
          },
          { status: opts.resendError.status },
        );
      }
      return HttpResponse.json({
        user: rows.find((r) => r.id === params.id),
        invite_link: null,
      });
    }),
  );
}

function renderScreen(session = ADMIN_SESSION) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider user={session}>
        <UsersScreen />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

const rowFor = (email: string) =>
  screen.getByText(email).closest('[role="row"]') as HTMLElement;

const openMenu = async (name: string) => {
  await userEvent.click(
    screen.getByRole("button", { name: `Actions for ${name}` }),
  );
  return screen.findByRole("menu");
};

/* --- menu gating ------------------------------------------------- */

describe("UsersScreen W19 — `···` menu gating", () => {
  it("an admin sees Deactivate on an editor and a manager row, not on the last active admin row", async () => {
    backend({ rows: [EDITOR, MANAGER_ROW, ADMIN_LAST] });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ada Nwosu");

    expect(
      within(await openMenu("Ada Nwosu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Deactivate"]);
    await userEvent.keyboard("{Escape}");

    expect(
      within(await openMenu("Dan Okoye"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Deactivate"]);
    await userEvent.keyboard("{Escape}");

    // Obi is the only active admin in the list — no Deactivate, so no menu.
    expect(
      screen.queryByRole("button", { name: "Actions for Obi Cole" }),
    ).not.toBeInTheDocument();
  });

  it("a manager sees Deactivate only on editor rows", async () => {
    backend({ rows: [EDITOR, MANAGER_ROW] });
    renderScreen(MANAGER_SESSION);
    await screen.findByText("Ada Nwosu");

    expect(
      within(await openMenu("Ada Nwosu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Deactivate"]);

    expect(
      screen.queryByRole("button", { name: "Actions for Dan Okoye" }),
    ).not.toBeInTheDocument();
  });

  it("a deactivated row offers Reactivate, not Deactivate", async () => {
    backend({ rows: [EDITOR_OFF] });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Eve Duru");

    expect(
      within(await openMenu("Eve Duru"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Reactivate"]);
  });

  it("Resend invite shows only while the account is still pending", async () => {
    backend({ rows: [EDITOR, EDITOR_PENDING] });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ivy Bassey");

    expect(
      within(await openMenu("Ivy Bassey"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Deactivate", "Resend invite"]);
    await userEvent.keyboard("{Escape}");

    expect(
      within(await openMenu("Ada Nwosu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Deactivate"]);
  });
});

/* --- deactivate + confirm dialog ------------------------------- */

describe("UsersScreen W19 — deactivate", () => {
  it("opens a confirmation dialog naming the user, then PATCHes …/active { is_active: false }", async () => {
    const calls: Array<{ id: string; body: unknown }> = [];
    backend({ rows: [EDITOR], onActive: (id, body) => calls.push({ id, body }) });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ada Nwosu");

    await userEvent.click(
      within(await openMenu("Ada Nwosu")).getByRole("menuitem", {
        name: "Deactivate",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ada Nwosu");
    expect(dialog).toHaveTextContent("ada@rhemapod.church");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ id: "u-ed", body: { is_active: false } });
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // Success feedback.
    expect(await screen.findByText(/Deactivated Ada Nwosu/)).toBeInTheDocument();
  });

  it("a 409 last-admin renders an explanatory inline message naming why — no toast, badge doesn't stick", async () => {
    // Two active admins visible, so the client gate lets the action through
    // and the backend's 409 is what's exercised.
    backend({
      rows: [
        ADMIN_LAST,
        user({
          id: "admin-7",
          email: "kay@rhemapod.church",
          full_name: "Kay Uzo",
          role: "admin",
        }),
      ],
      activeError: {
        status: 409,
        detail:
          "This is the last active administrator. Promote or activate another admin before changing this account.",
      },
    });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Obi Cole");

    await userEvent.click(
      within(await openMenu("Obi Cole")).getByRole("menuitem", {
        name: "Deactivate",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );

    // The reason is named, in place, in the still-open dialog.
    const inline = await within(dialog).findByText(/last active admin/i);
    expect(inline).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Not surfaced as the card-top failure alert, and no success toast.
    expect(
      screen.queryByText("That change didn’t go through"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Deactivated Obi Cole/)).not.toBeInTheDocument();

    // Badge rolled back to Active.
    const badge = within(rowFor("obi@rhemapod.church")).getByTestId(
      "user-state",
    );
    await vi.waitFor(() => expect(badge).toHaveTextContent("Active"));
  });

  it("`revocation_deferred: true` renders the non-blocking sessions note", async () => {
    backend({
      rows: [EDITOR],
      activeResponse: { revocation_deferred: true },
    });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ada Nwosu");

    await userEvent.click(
      within(await openMenu("Ada Nwosu")).getByRole("menuitem", {
        name: "Deactivate",
      }),
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Deactivate",
      }),
    );

    expect(
      await screen.findByText(/sessions may take a moment to end/i),
    ).toBeInTheDocument();
  });
});

/* --- reactivate ----------------------------------------------- */

describe("UsersScreen W19 — reactivate", () => {
  it("PATCHes …/active { is_active: true } with no confirm dialog", async () => {
    const calls: Array<{ id: string; body: unknown }> = [];
    backend({
      rows: [EDITOR_OFF],
      onActive: (id, body) => calls.push({ id, body }),
    });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Eve Duru");

    await userEvent.click(
      within(await openMenu("Eve Duru")).getByRole("menuitem", {
        name: "Reactivate",
      }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ id: "u-off", body: { is_active: true } });
  });
});

/* --- resend invite ------------------------------------------- */

describe("UsersScreen W19 — resend invite", () => {
  it("POSTs …/resend-invite and gives explicit success feedback", async () => {
    const calls: string[] = [];
    backend({ rows: [EDITOR_PENDING], onResend: (id) => calls.push(id) });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ivy Bassey");

    await userEvent.click(
      within(await openMenu("Ivy Bassey")).getByRole("menuitem", {
        name: "Resend invite",
      }),
    );

    await vi.waitFor(() => expect(calls).toEqual(["u-pend"]));
    expect(
      await screen.findByText(/Invite resent to ivy@rhemapod\.church/),
    ).toBeInTheDocument();
  });

  it.each([
    [409, /already been activated/i],
    [429, /too many/i],
    [503, /couldn’t reach the invite service/i],
  ])("a %i renders its own inline message", async (status, matcher) => {
    backend({
      rows: [EDITOR_PENDING],
      resendError: { status: status as number },
    });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ivy Bassey");

    await userEvent.click(
      within(await openMenu("Ivy Bassey")).getByRole("menuitem", {
        name: "Resend invite",
      }),
    );

    expect(await screen.findByText(matcher as RegExp)).toBeInTheDocument();
  });
});

/* --- State column ------------------------------------------- */

describe("UsersScreen W19 — State column", () => {
  it("renders the right text badge for active / deactivated / pending, and the badge carries a text node", async () => {
    backend({ rows: [EDITOR, EDITOR_OFF, EDITOR_PENDING] });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ada Nwosu");

    const cases: Array<[string, string]> = [
      ["ada@rhemapod.church", "Active"],
      ["eve@rhemapod.church", "Deactivated"],
      ["ivy@rhemapod.church", "Invite pending"],
    ];
    for (const [email, label] of cases) {
      const badge = within(rowFor(email)).getByTestId("user-state");
      expect(badge).toHaveTextContent(label);
      // Not colour-only: a real text node, readable in a monochrome render.
      const hasText = Array.from(badge.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0,
      );
      expect(hasText).toBe(true);
    }
  });
});

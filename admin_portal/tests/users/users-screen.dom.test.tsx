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
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SessionProvider } from "@/lib/auth/session-context";
import { queryKeys } from "@/lib/query/keys";
import { UsersScreen } from "@/components/users/users-screen";
import type { UserPublic } from "@/lib/query/hooks/use-users";

/* W17 — the Users & roles screen, rendered (happy-dom). Every backend call is
   MSW, never a mocked fetch (§A.11). Covers: the tiles reading `role-counts`
   (a real Viewers number with zero viewers in the list), the role filter
   writing `?role=` and never offering Viewers, the optimistic inline role
   change + a `_may_assign` 400 rolling back to a card-top alert, the control
   hidden for a manager and on the caller's own row, and the invite POST with
   its exact body / new row / duplicate + 5xx handling. */

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
  const g = globalThis as unknown as {
    ResizeObserver?: unknown;
    matchMedia?: unknown;
  };
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
  created_at: "2024-06-21T10:00:00Z",
  ...over,
});

const STAFF: UserPublic[] = [
  user({ id: "u-mgr", email: "dan@rhemapod.church", full_name: "Dan Okoye", role: "manager" }),
  user({ id: "u-ed", email: "ada@rhemapod.church", full_name: "Ada Nwosu", role: "editor" }),
];

const COUNTS = { viewer: 4812, editor: 6, manager: 2, admin: 2, total: 4822 };

interface BackendOpts {
  rows?: UserPublic[];
  counts?: typeof COUNTS;
  onList?: (q: URLSearchParams) => void;
  onPatch?: (id: string, body: unknown) => void;
  patchError?: { status: number; detail?: string };
  onPost?: (body: unknown) => void;
  postError?: { status: number; detail?: string };
}

function backend(opts: BackendOpts = {}) {
  const counts = opts.counts ?? COUNTS;
  let rows: UserPublic[] = (opts.rows ?? STAFF).map((r) => ({ ...r }));

  server.use(
    http.get("*/api/bff/users/role-counts", () => HttpResponse.json(counts)),
    http.get("*/api/bff/users", ({ request }) => {
      const q = new URL(request.url).searchParams;
      opts.onList?.(q);
      const role = q.get("role");
      const filtered = role ? rows.filter((r) => r.role === role) : rows;
      return HttpResponse.json({
        items: filtered,
        total: filtered.length,
        limit: 25,
        offset: 0,
      });
    }),
    http.patch("*/api/bff/users/:id/role", async ({ params, request }) => {
      const body = await request.json();
      opts.onPatch?.(String(params.id), body);
      await delay(20);
      if (opts.patchError) {
        return HttpResponse.json(
          { detail: opts.patchError.detail ?? "Rejected", correlation_id: "cid-p" },
          { status: opts.patchError.status },
        );
      }
      const nextRole = (body as { role: UserPublic["role"] }).role;
      rows = rows.map((r) =>
        r.id === params.id ? { ...r, role: nextRole } : r,
      );
      return HttpResponse.json(rows.find((r) => r.id === params.id));
    }),
    http.post("*/api/bff/users", async ({ request }) => {
      const body = (await request.json()) as {
        email: string;
        full_name: string | null;
        role: UserPublic["role"];
      };
      opts.onPost?.(body);
      await delay(20);
      if (opts.postError) {
        return HttpResponse.json(
          { detail: opts.postError.detail ?? undefined, correlation_id: "cid-c" },
          { status: opts.postError.status },
        );
      }
      const created = user({
        id: `u-${rows.length + 1}`,
        email: body.email,
        full_name: body.full_name,
        role: body.role,
        created_at: "2026-09-10T09:00:00Z",
      });
      rows = [...rows, created];
      return HttpResponse.json(
        { user: created, invite_link: null },
        { status: 201 },
      );
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
  const utils = render(
    <QueryClientProvider client={client}>
      <SessionProvider user={session}>
        <UsersScreen />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

const roleSelect = (name: string) =>
  screen.getByLabelText(`Role for ${name}`) as HTMLSelectElement;

/* --- tiles -------------------------------------------------------- */

describe("UsersScreen — count tiles", () => {
  it("renders the four headcounts from /role-counts, with a real Viewers number and no viewer row", async () => {
    backend();
    renderScreen();

    await screen.findByText("Dan Okoye");

    expect(screen.getByTestId("role-count-viewer")).toHaveTextContent("4,812");
    expect(screen.getByTestId("role-count-editor")).toHaveTextContent("6");
    expect(screen.getByTestId("role-count-manager")).toHaveTextContent("2");
    expect(screen.getByTestId("role-count-admin")).toHaveTextContent("2");

    // The list beside the tiles is staff-only: header + the two staff rows.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

/* --- role filter ------------------------------------------------- */

describe("UsersScreen — role filter", () => {
  it("sends ?role= on the wire when the URL carries one", async () => {
    const lists: URLSearchParams[] = [];
    nav.search = new URLSearchParams("role=manager");
    backend({ onList: (q) => lists.push(q) });
    renderScreen();

    await screen.findByText("Dan Okoye");
    expect(lists.at(-1)!.get("role")).toBe("manager");
    // The editor row is filtered out server-side.
    expect(screen.queryByText("Ada Nwosu")).not.toBeInTheDocument();
  });

  it("changing the filter writes ?role= and replaces (not pushes); Viewers is never an option", async () => {
    backend();
    renderScreen();
    await screen.findByText("Dan Okoye");

    const group = screen.getByRole("radiogroup", {
      name: "Filter staff by role",
    });
    expect(
      within(group).queryByRole("radio", { name: "Viewers" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(group).getByRole("radio", { name: "Editors" }),
    );

    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalled();
    expect(nav.replace.mock.calls.at(-1)![0]).toContain("role=editor");
  });
});

/* --- inline role change ---------------------------------------- */

describe("UsersScreen — inline role change", () => {
  it("PATCHes /users/{id}/role with the picked role and updates optimistically (admin session)", async () => {
    const patches: Array<{ id: string; body: unknown }> = [];
    backend({ onPatch: (id, body) => patches.push({ id, body }) });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Dan Okoye");

    await userEvent.selectOptions(roleSelect("Dan Okoye"), "editor");

    await vi.waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ id: "u-mgr", body: { role: "editor" } });
    // Optimistic: the select already shows the new role before the refetch.
    expect(roleSelect("Dan Okoye").value).toBe("editor");
  });

  it("a _may_assign 400 rolls the row back and surfaces a card-top alert, not a toast", async () => {
    backend({
      patchError: {
        status: 400,
        detail: "You are not permitted to assign the 'admin' role",
      },
    });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Dan Okoye");

    await userEvent.selectOptions(roleSelect("Dan Okoye"), "admin");

    const alert = await screen.findByText(/not permitted to assign/);
    expect(alert).toHaveTextContent("reference: cid-p");
    expect(
      screen.getByText("That change didn’t go through"),
    ).toBeInTheDocument();
    // No optimistic stick — back to manager.
    await vi.waitFor(() =>
      expect(roleSelect("Dan Okoye").value).toBe("manager"),
    );
  });

  it("shows a static chip — no editable control — for the caller's own row", async () => {
    backend({
      rows: [
        user({ id: "admin-1", email: "sam@rhemapod.church", full_name: "Sam Oke", role: "admin" }),
        ...STAFF,
      ],
    });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Sam Oke");

    const ownRow = screen.getByText("sam@rhemapod.church").closest('[role="row"]')!;
    expect(
      within(ownRow as HTMLElement).queryByRole("combobox"),
    ).not.toBeInTheDocument();
    expect(within(ownRow as HTMLElement).getByText("Admin")).toBeInTheDocument();
    // Other rows are still editable for an admin.
    expect(roleSelect("Dan Okoye")).toBeInTheDocument();
  });

  it("gives a manager no editable control on any row — chips only", async () => {
    backend();
    renderScreen(MANAGER_SESSION);
    await screen.findByText("Dan Okoye");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Role for/)).not.toBeInTheDocument();
    // The chip is still there for each row.
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
  });

  it("the role control is keyboard operable — the row nav handler doesn't swallow its keys", async () => {
    const patches: Array<{ id: string; body: unknown }> = [];
    backend({ onPatch: (id, body) => patches.push({ id, body }) });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Ada Nwosu");

    const select = roleSelect("Ada Nwosu");
    select.focus();
    expect(select).toHaveFocus();

    // The W6 DataTable row `<div>` attaches an unconditional keydown handler
    // that `preventDefault()`s ArrowUp/ArrowDown/Home/End for row navigation,
    // and a plain column cell (unlike `__actions`) doesn't stopPropagation. A
    // native `<select>` needs every one of those keys, plus `Alt+ArrowDown` to
    // open the listbox. `fireEvent.keyDown` returns `false` when a handler
    // called `preventDefault()` — so this is the exact regression signal:
    // `true` means the key reached the control with its default intact.
    // (`userEvent.keyboard('{ArrowDown}')` can't stand in here: neither
    // user-event v14 nor happy-dom implements native `<select>` option
    // navigation, so it never changes `.value` and there is nothing to assert.)
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"] as const) {
      expect(fireEvent.keyDown(select, { key })).toBe(true);
      expect(select).toHaveFocus();
    }
    expect(fireEvent.keyDown(select, { key: "ArrowDown", altKey: true })).toBe(
      true,
    );
    expect(select).toHaveFocus();

    // And the `change` the option list emits still drives the PATCH.
    await userEvent.selectOptions(select, "manager");
    await vi.waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ id: "u-ed", body: { role: "manager" } });
    expect(select.value).toBe("manager");
  });
});

/* --- invite ---------------------------------------------------- */

describe("UsersScreen — invite staff", () => {
  const openDialog = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Invite staff" }));
    return screen.findByRole("dialog");
  };

  it("POSTs /users with { email, full_name, role } and the new row appears", async () => {
    const bodies: unknown[] = [];
    backend({ onPost: (b) => bodies.push(b) });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Dan Okoye");

    const dialog = await openDialog();
    await userEvent.type(
      within(dialog).getByLabelText("Email"),
      "cara@rhemapod.church",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send invite" }),
    );

    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      email: "cara@rhemapod.church",
      full_name: null,
      role: "editor",
    });

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("cara@rhemapod.church")).toBeInTheDocument();
  });

  it("blocks submit on a blank email and fires no request", async () => {
    const bodies: unknown[] = [];
    backend({ onPost: (b) => bodies.push(b) });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Dan Okoye");

    const dialog = await openDialog();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send invite" }),
    );

    expect(
      await within(dialog).findByText("Enter a valid email address."),
    ).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(bodies).toHaveLength(0);
  });

  it("surfaces a duplicate-email 400 inline and keeps the dialog open", async () => {
    backend({
      postError: {
        status: 400,
        detail: "A user with that email already exists",
      },
    });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Dan Okoye");

    const dialog = await openDialog();
    await userEvent.type(
      within(dialog).getByLabelText("Email"),
      "dan@rhemapod.church",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send invite" }),
    );

    expect(
      await within(dialog).findByText(/already exists/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("surfaces a 5xx (nothing created — the POST is transactional) inline", async () => {
    backend({ postError: { status: 500 } });
    renderScreen(ADMIN_SESSION);
    await screen.findByText("Dan Okoye");

    const dialog = await openDialog();
    await userEvent.type(
      within(dialog).getByLabelText("Email"),
      "new@rhemapod.church",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send invite" }),
    );

    expect(
      await within(dialog).findByText(/Server error/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("new@rhemapod.church")).not.toBeInTheDocument();
  });

  it("a manager's invite dialog offers Editor only", async () => {
    backend();
    renderScreen(MANAGER_SESSION);
    await screen.findByText("Dan Okoye");

    const dialog = await openDialog();
    const roleField = within(dialog).getByLabelText("Role") as HTMLSelectElement;
    expect(
      Array.from(roleField.options).map((o) => o.value),
    ).toEqual(["editor"]);
    expect(roleField).toBeDisabled();
  });
});

/* --- invalidation touchpoint --------------------------------- */

describe("UsersScreen — cache", () => {
  it("a role change invalidates the users domain (list + tiles)", async () => {
    backend();
    const { client } = renderScreen(ADMIN_SESSION);
    await screen.findByText("Dan Okoye");

    const spy = vi.spyOn(client, "invalidateQueries");
    await userEvent.selectOptions(roleSelect("Dan Okoye"), "editor");

    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.users.all() }),
    );
  });
});

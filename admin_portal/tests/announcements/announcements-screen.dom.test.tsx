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
import { queryKeys } from "@/lib/query/keys";
import { AnnouncementsScreen } from "@/components/announcements/announcements-screen";
import type { AnnouncementAdminItem } from "@/lib/query/hooks/use-announcements";

/* W13 — the Announcements list, rendered (happy-dom). Every backend call is
   MSW, never a mocked fetch (§A.11). Covers: the three Window forms from
   representative payloads, `is_visible` overriding a contradictory date
   computation, the (status × role) row menu wiring each action to the right
   endpoint, the reject-with-note panel, the status filter writing `?status=`,
   and a Scheduled row turning Live on a *refetch* (an advanced MSW response,
   not a client timer). */

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
  usePathname: () => "/announcements",
  useSearchParams: () => nav.search,
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

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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

const DAY = 86_400_000;
const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString();

const row = (over: Partial<AnnouncementAdminItem>): AnnouncementAdminItem => ({
  id: "a-1",
  title: "Baptism Sunday — sign up",
  description: null,
  image_url: null,
  pinned: false,
  publish_at: null,
  created_at: iso(-10),
  body: "Sign-up closes Friday.",
  expires_at: null,
  status: "draft",
  is_visible: false,
  created_by: "u-1",
  ...over,
});

const page = (items: AnnouncementAdminItem[], total = items.length) => ({
  items,
  total,
  limit: 25,
  offset: 0,
});

function backend(
  rows: AnnouncementAdminItem[],
  onList?: (query: URLSearchParams) => void,
) {
  server.use(
    http.get("*/api/bff/announcements/admin/all", ({ request }) => {
      onList?.(new URL(request.url).searchParams);
      return HttpResponse.json(page(rows));
    }),
  );
}

function stubConfirm(result = true): () => void {
  const original = window.confirm;
  window.confirm = vi.fn(() => result);
  return () => {
    window.confirm = original;
  };
}

function renderScreen(role = "manager") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <SessionProvider user={{ id: "u-1", email: "e@x.dev", name: "Ed", role }}>
        <AnnouncementsScreen />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

const windowCell = (title: string): HTMLElement => {
  const rowEl = screen.getByText(title).closest('[role="row"]');
  if (!rowEl) throw new Error(`no row for ${title}`);
  const cell = rowEl.querySelector<HTMLElement>("[data-window-tone]");
  if (!cell) throw new Error(`no window cell for ${title}`);
  return cell;
};

/* --- window forms -------------------------------------------------- */

describe("AnnouncementsScreen — the three Window forms", () => {
  it("renders live / scheduled / ended / unscheduled from server payloads", async () => {
    backend([
      row({
        id: "live-exp",
        title: "Live with expiry",
        is_visible: true,
        publish_at: iso(-3),
        expires_at: iso(6),
        status: "published",
      }),
      row({
        id: "live-noexp",
        title: "Live no expiry",
        is_visible: true,
        publish_at: iso(-1),
        expires_at: null,
        status: "published",
      }),
      row({
        id: "sched",
        title: "Scheduled soon",
        is_visible: false,
        publish_at: iso(4),
        expires_at: iso(11),
        status: "approved",
      }),
      row({
        id: "ended",
        title: "Already ended",
        is_visible: false,
        publish_at: iso(-20),
        expires_at: iso(-6),
        status: "archived",
      }),
      row({
        id: "unsched",
        title: "Never scheduled",
        is_visible: false,
        publish_at: null,
        status: "draft",
      }),
    ]);

    renderScreen();
    await screen.findByText("Live with expiry");

    expect(windowCell("Live with expiry")).toHaveAttribute(
      "data-window-tone",
      "live",
    );
    expect(windowCell("Live with expiry").textContent).toMatch(
      /^[A-Z][a-z]{2} \d{1,2} → [A-Z][a-z]{2} \d{1,2}$/,
    );

    expect(windowCell("Live no expiry")).toHaveAttribute(
      "data-window-tone",
      "live",
    );
    expect(windowCell("Live no expiry").textContent).toMatch(
      /^[A-Z][a-z]{2} \d{1,2} → —$/,
    );

    expect(windowCell("Scheduled soon")).toHaveAttribute(
      "data-window-tone",
      "scheduled",
    );
    expect(windowCell("Already ended")).toHaveAttribute(
      "data-window-tone",
      "ended",
    );
    expect(windowCell("Never scheduled").textContent).toBe("not scheduled");
    expect(windowCell("Never scheduled")).toHaveAttribute(
      "data-window-tone",
      "unscheduled",
    );
  });

  it("is_visible wins: dates say 'open now' but the server says not visible → not live (scheduled, not ended)", async () => {
    backend([
      row({
        id: "skew",
        title: "Contested row",
        // publish in the past, expiry in the future → naive dates say "live"
        publish_at: iso(-2),
        expires_at: iso(9),
        is_visible: false,
        status: "approved",
      }),
    ]);

    renderScreen();
    await screen.findByText("Contested row");

    expect(windowCell("Contested row")).not.toHaveAttribute(
      "data-window-tone",
      "live",
    );
    // expiry still ahead → the guard keeps it "scheduled" (about to go live),
    // never the ink-faint "ended".
    expect(windowCell("Contested row")).toHaveAttribute(
      "data-window-tone",
      "scheduled",
    );
  });

  it("is_visible wins the other way: dates look expired but the server says visible → live", async () => {
    backend([
      row({
        id: "skew2",
        title: "Still showing",
        publish_at: iso(-30),
        expires_at: iso(-2),
        is_visible: true,
        status: "published",
      }),
    ]);

    renderScreen();
    await screen.findByText("Still showing");

    expect(windowCell("Still showing")).toHaveAttribute(
      "data-window-tone",
      "live",
    );
  });
});

/* --- pinned dot -------------------------------------------------- */

describe("AnnouncementsScreen — pinned rows", () => {
  it("shows the dot + 'pinned' sub-label only for pinned rows", async () => {
    backend([
      row({ id: "p", title: "Pinned notice", pinned: true }),
      row({ id: "np", title: "Plain notice", pinned: false, description: "Some detail" }),
    ]);

    renderScreen();
    await screen.findByText("Pinned notice");

    const pinnedRow = screen.getByText("Pinned notice").closest('[role="row"]')!;
    expect(within(pinnedRow as HTMLElement).getByText("pinned")).toBeInTheDocument();

    const plainRow = screen.getByText("Plain notice").closest('[role="row"]')!;
    expect(
      within(plainRow as HTMLElement).queryByText("pinned"),
    ).not.toBeInTheDocument();
    // description shows as the sub-line when not pinned
    expect(
      within(plainRow as HTMLElement).getByText("Some detail"),
    ).toBeInTheDocument();
  });
});

/* --- row menu × endpoint wiring -------------------------------- */

describe("AnnouncementsScreen — row menu actions hit the right endpoint", () => {
  const openRowMenu = async (title: string) => {
    await userEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
    return screen.findByRole("menu");
  };

  it("(pending_review, manager) → Approve · Reject · Edit · Delete; Approve POSTs …/approve", async () => {
    let approved = false;
    // A different creator's submission — round 2's self-approval gate only
    // locks Approve for the viewer's OWN content (see the dedicated
    // "self-approval UX" describe block below for the own-content case).
    backend([
      row({
        status: "pending_review",
        title: "Needs a call",
        created_by: "someone-else",
      }),
    ]);
    server.use(
      http.post("*/api/bff/approvals/announcements/a-1/approve", () => {
        approved = true;
        return HttpResponse.json({ id: "a-1", status: "approved" });
      }),
    );

    renderScreen("manager");
    await screen.findByText("Needs a call");

    const menu = await openRowMenu("Needs a call");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Approve", "Reject", "Edit", "Delete"]);

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Approve" }));
    await vi.waitFor(() => expect(approved).toBe(true));
  });

  it("(approved, manager) → Publish POSTs …/publish", async () => {
    let published = false;
    backend([row({ status: "approved", title: "Ready to go" })]);
    server.use(
      http.post("*/api/bff/approvals/announcements/a-1/publish", () => {
        published = true;
        return HttpResponse.json({ id: "a-1", status: "published" });
      }),
    );

    renderScreen("manager");
    await screen.findByText("Ready to go");
    const menu = await openRowMenu("Ready to go");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Publish" }));
    await vi.waitFor(() => expect(published).toBe(true));
  });

  it("(published, manager) → Archive POSTs …/archive; (published, editor) → only a disabled Edit", async () => {
    let archived = false;
    backend([row({ status: "published", title: "Old news" })]);
    server.use(
      http.post("*/api/bff/approvals/announcements/a-1/archive", () => {
        archived = true;
        return HttpResponse.json({ id: "a-1", status: "archived" });
      }),
    );

    const { unmount } = renderScreen("manager");
    await screen.findByText("Old news");
    let menu = await openRowMenu("Old news");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Unpublish", "Edit", "Archive"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Archive" }));
    await vi.waitFor(() => expect(archived).toBe(true));
    unmount();

    backend([row({ status: "published", title: "Old news" })]);
    renderScreen("editor");
    await screen.findByText("Old news");
    menu = await openRowMenu("Old news");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Edit (locked)"]);
    expect(items[0]).toHaveAttribute("data-disabled");
  });

  it("(draft) → Delete DELETEs after a confirm", async () => {
    let deleted = false;
    backend([row({ status: "draft", title: "Scratch" })]);
    server.use(
      http.delete("*/api/bff/announcements/a-1", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const restore = stubConfirm(true);
    try {
      renderScreen("manager");
      await screen.findByText("Scratch");
      const menu = await openRowMenu("Scratch");
      await userEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
      await vi.waitFor(() => expect(deleted).toBe(true));
    } finally {
      restore();
    }
  });

  it("Reject opens a note panel and POSTs …/reject with the typed note", async () => {
    let body: unknown = null;
    backend([row({ status: "pending_review", title: "Send this back" })]);
    server.use(
      http.post("*/api/bff/approvals/announcements/a-1/reject", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a-1", status: "rejected" });
      }),
    );

    renderScreen("manager");
    await screen.findByText("Send this back");
    const menu = await openRowMenu("Send this back");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Reject" }));

    const note = await screen.findByLabelText("Rejection note");
    await userEvent.type(note, "Tighten the closing line.");
    await userEvent.click(screen.getByRole("button", { name: "Send back" }));

    await vi.waitFor(() =>
      expect(body).toEqual({ note: "Tighten the closing line." }),
    );
  });

  it("a failed reject keeps the note panel + the typed note, and retries", async () => {
    let attempts = 0;
    const bodies: unknown[] = [];
    backend([row({ status: "pending_review", title: "Second look" })]);
    server.use(
      http.post(
        "*/api/bff/approvals/announcements/a-1/reject",
        async ({ request }) => {
          attempts += 1;
          bodies.push(await request.json());
          if (attempts === 1) {
            await delay(10);
            return HttpResponse.json(
              { detail: "Reject service is down", correlation_id: "cid-r" },
              { status: 503 },
            );
          }
          return HttpResponse.json({ id: "a-1", status: "rejected" });
        },
      ),
    );

    renderScreen("manager");
    await screen.findByText("Second look");
    const menu = await openRowMenu("Second look");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Reject" }));

    const note = await screen.findByLabelText("Rejection note");
    await userEvent.type(note, "Fix the date in paragraph two.");
    await userEvent.click(screen.getByRole("button", { name: "Send back" }));

    // First attempt fails → the panel and the note are still there.
    expect(await screen.findByText(/Reject service is down/)).toBeInTheDocument();
    const stillThere = screen.getByLabelText("Rejection note") as HTMLTextAreaElement;
    expect(stillThere).toBeInTheDocument();
    expect(stillThere.value).toBe("Fix the date in paragraph two.");

    // Retry from the same panel → succeeds → panel unmounts.
    await userEvent.click(screen.getByRole("button", { name: "Send back" }));
    await vi.waitFor(() =>
      expect(screen.queryByLabelText("Rejection note")).not.toBeInTheDocument(),
    );

    expect(attempts).toBe(2);
    expect(bodies).toEqual([
      { note: "Fix the date in paragraph two." },
      { note: "Fix the date in paragraph two." },
    ]);
  });

  it("surfaces a failed action as an alert, not a toast", async () => {
    backend([row({ status: "approved", title: "Will fail" })]);
    server.use(
      http.post("*/api/bff/approvals/announcements/a-1/publish", async () => {
        await delay(10);
        return HttpResponse.json(
          { detail: "Nothing to publish", correlation_id: "cid-x" },
          { status: 409 },
        );
      }),
    );

    renderScreen("manager");
    await screen.findByText("Will fail");
    const menu = await screen.findByRole("menu", { hidden: true }).catch(() => null);
    void menu;
    await userEvent.click(screen.getByRole("button", { name: "Actions for Will fail" }));
    const open = await screen.findByRole("menu");
    await userEvent.click(within(open).getByRole("menuitem", { name: "Publish" }));

    const alert = await screen.findByText("That action didn’t go through");
    expect(alert).toBeInTheDocument();
    expect(
      await screen.findByText(/Nothing to publish/),
    ).toHaveTextContent("reference: cid-x");
  });
});

/* --- self-approval UX (round 2) ------------------------------------ */

describe("AnnouncementsScreen — self-approval UX (row menu)", () => {
  const openRowMenu = async (title: string) => {
    await userEvent.click(
      screen.getByRole("button", { name: `Actions for ${title}` }),
    );
    return screen.findByRole("menu");
  };

  it("pending_review, own content, manager → Approve is locked (disabled + explanatory title); Reject/Edit/Delete stay live", async () => {
    // The default fixture's created_by ("u-1") matches renderScreen("manager")'s
    // default session id — this row IS the viewer's own submission.
    backend([row({ status: "pending_review", title: "My own submission" })]);

    renderScreen("manager");
    await screen.findByText("My own submission");
    const menu = await openRowMenu("My own submission");

    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Approve",
      "Reject",
      "Edit",
      "Delete",
    ]);
    const approve = items[0];
    expect(approve).toHaveAttribute("data-disabled");
    expect(approve).toHaveAttribute(
      "title",
      "You submitted this — another manager needs to review it.",
    );
    // Reject is never self-gated.
    expect(items[1]).not.toHaveAttribute("data-disabled");
  });

  it("pending_review, own content, admin → unaffected, Approve stays live", async () => {
    backend([row({ status: "pending_review", title: "Admin's own submission" })]);

    renderScreen("admin");
    await screen.findByText("Admin's own submission");
    const menu = await openRowMenu("Admin's own submission");

    const approve = within(menu).getByRole("menuitem", { name: "Approve" });
    expect(approve).not.toHaveAttribute("data-disabled");
  });
});

/* --- filter + poll ------------------------------------------------- */

describe("AnnouncementsScreen — status filter", () => {
  it("changing the filter writes ?status= and replaces (not pushes) history", async () => {
    backend([row({ title: "Anything" })]);

    renderScreen("manager");
    await screen.findByText("Anything");

    await userEvent.selectOptions(
      screen.getByLabelText("Filter announcements by status"),
      "pending_review",
    );

    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalled();
    expect(nav.replace.mock.calls.at(-1)![0]).toContain("status=pending_review");
  });
});

describe("AnnouncementsScreen — a Scheduled row turns Live on a refetch", () => {
  it("re-reads is_visible from an advanced server response, not a client timer", async () => {
    let visible = false;
    server.use(
      http.get("*/api/bff/announcements/admin/all", () =>
        HttpResponse.json(
          page([
            row({
              id: "flip",
              title: "Goes live shortly",
              publish_at: iso(0.001),
              expires_at: iso(7),
              status: "published",
              is_visible: visible,
            }),
          ]),
        ),
      ),
    );

    const { client } = renderScreen("manager");
    await screen.findByText("Goes live shortly");
    expect(windowCell("Goes live shortly")).toHaveAttribute(
      "data-window-tone",
      "scheduled",
    );

    // The server clock advances — the announcement is now visible.
    visible = true;
    await client.invalidateQueries({ queryKey: queryKeys.announcements.all() });

    await vi.waitFor(() =>
      expect(windowCell("Goes live shortly")).toHaveAttribute(
        "data-window-tone",
        "live",
      ),
    );
  });
});

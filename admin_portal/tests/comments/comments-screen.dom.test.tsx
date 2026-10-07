import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { CommentsScreen } from "@/components/comments/comments-screen";
import { SessionProvider } from "@/lib/auth/session-context";
import type { AdminCommentRow } from "@/lib/query/hooks/use-admin-comments";

/* S12 — the comments queue, rendered (happy-dom). Every backend call is MSW.
   Covers role gating (EDITOR / MANAGER / ADMIN), hide / restore / dismiss /
   delete, the required-reason rule, 403 / 404 / 409 handling, the URL -> query
   mapping, and the plain-text rendering rule. */

const nav = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  search: new URLSearchParams(),
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
  usePathname: () => "/comments",
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
  nav.search = new URLSearchParams();
});
afterAll(() => server.close());

/* --- fixtures ----------------------------------------------------------- */

const base = {
  author_display_name: "Nii O.",
  body: "God is good",
  created_at: "2026-10-01T10:00:00Z",
  hidden_auto: false,
  id: "c-1",
  is_mine: false,
  report_count: 2,
  sermon_id: "s-1",
  sermon_title: "The Prodigal Son",
  status: "VISIBLE" as const,
};

function managerRow(over: Record<string, unknown> = {}): AdminCommentRow {
  return {
    ...base,
    author_email: "nii@example.com",
    author_id: "u-1",
    hidden_by_id: null,
    ...over,
  } as AdminCommentRow;
}

function editorRow(over: Record<string, unknown> = {}): AdminCommentRow {
  return { ...base, ...over } as AdminCommentRow;
}

const VISIBLE_REPORTED = managerRow();
const AUTO_HIDDEN = managerRow({
  id: "c-2",
  body: "Second comment",
  status: "HIDDEN",
  hidden_auto: true,
  hidden_at: "2026-10-01T11:00:00Z",
  report_count: 3,
});

interface Calls {
  list: URLSearchParams[];
  writes: Array<{ method: string; path: string; body: unknown }>;
}

interface BackendOpts {
  rows?: AdminCommentRow[];
  total?: number;
  listStatus?: number;
  /** Status to answer a given write path suffix with. */
  failWrite?: { match: string; status: number };
}

function backend(opts: BackendOpts = {}): Calls {
  const calls: Calls = { list: [], writes: [] };
  const rows = opts.rows ?? [VISIBLE_REPORTED, AUTO_HIDDEN];

  server.use(
    http.get("*/api/bff/admin/comments", ({ request }) => {
      calls.list.push(new URL(request.url).searchParams);
      if (opts.listStatus) {
        return HttpResponse.json(
          { detail: "boom", correlation_id: "c" },
          { status: opts.listStatus },
        );
      }
      return HttpResponse.json({
        items: rows,
        total: opts.total ?? rows.length,
        limit: 25,
        offset: 0,
      });
    }),
    ...(["post", "delete"] as const).map((verb) =>
      http[verb]("*/api/bff/admin/comments/*", async ({ request }) => {
        const text = await request.text();
        const path = new URL(request.url).pathname;
        calls.writes.push({
          method: request.method,
          path,
          body: text ? JSON.parse(text) : null,
        });
        if (opts.failWrite && path.endsWith(opts.failWrite.match)) {
          return HttpResponse.json(
            { detail: "nope", correlation_id: "c" },
            { status: opts.failWrite.status },
          );
        }
        if (verb === "delete") return new HttpResponse(null, { status: 204 });
        return HttpResponse.json(VISIBLE_REPORTED);
      }),
    ),
  );
  return calls;
}

function renderScreen(role: "editor" | "manager" | "admin") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider
        user={{ id: "me", email: "me@example.com", name: "Me", role }}
      >
        <CommentsScreen />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, body: string) {
  // The row's body text identifies it; the menu button is in the same row.
  const cell = await screen.findByText(body);
  const row = cell.closest('[role="row"]') as HTMLElement;
  await user.click(
    within(row).getByRole("button", { name: /Actions for comment by/ }),
  );
}

/* --- list, filters, rendering ------------------------------------------- */

describe("CommentsScreen — list", () => {
  it("defaults to Reported + most_reported and shows the rows with plain-text bodies", async () => {
    const calls = backend({
      rows: [managerRow({ body: "<b>bold</b> https://x.test" })],
    });
    renderScreen("manager");

    // Rendered as literal text, not markup and not a link.
    expect(await screen.findByText("<b>bold</b> https://x.test")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /x\.test/ })).toBeNull();

    const q = calls.list[0];
    expect(q.get("reported_only")).toBe("true");
    expect(q.get("sort")).toBe("most_reported");
    expect(q.get("status")).toBeNull();
    expect(screen.getByText(/Auto-hidden comments appear first/)).toBeInTheDocument();
  });

  it("maps the URL: status=hidden -> status=HIDDEN, sort=recent, sermon_id", async () => {
    nav.search = new URLSearchParams("status=hidden&sort=recent&sermon_id=s-9");
    const calls = backend();
    renderScreen("manager");
    await screen.findByText("God is good");

    const q = calls.list[0];
    expect(q.get("status")).toBe("HIDDEN");
    expect(q.get("reported_only")).toBeNull();
    expect(q.get("sort")).toBe("recent");
    expect(q.get("sermon_id")).toBe("s-9");
  });

  it("a sermon deep link with no status defaults to All and shows a removable chip", async () => {
    nav.search = new URLSearchParams("sermon_id=s-1");
    const calls = backend();
    const user = userEvent.setup();
    renderScreen("manager");
    await screen.findByText("God is good");

    expect(calls.list[0].get("reported_only")).toBeNull();
    expect(calls.list[0].get("status")).toBeNull();
    expect(screen.getByText("Sermon: The Prodigal Son")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear sermon filter" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/comments", { scroll: false });
  });

  it("changing the segment writes ?status= and resets the page", async () => {
    nav.search = new URLSearchParams("page=2");
    backend({ total: 60 });
    const user = userEvent.setup();
    renderScreen("manager");
    await screen.findByText("God is good");

    await user.click(screen.getByRole("radio", { name: "Hidden" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/comments?status=hidden", {
      scroll: false,
    });
  });

  it("shows the per-filter empty state", async () => {
    backend({ rows: [] });
    renderScreen("manager");
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("shows an error alert with Retry when the list fails", async () => {
    backend({ listStatus: 500 });
    renderScreen("manager");
    expect(await screen.findByText("Couldn’t load comments.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("CommentsScreen — detail dialog", () => {
  it("makes the scrollable body a keyboard-focusable region", async () => {
    backend();
    const user = userEvent.setup();
    renderScreen("manager");

    await user.click(await screen.findByText("God is good"));
    const dialog = await screen.findByRole("dialog");
    const body = within(dialog).getByTestId("comment-full-body");

    expect(body).toHaveAttribute("tabindex", "0");
    body.focus();
    expect(body).toHaveFocus();
  });
});

/* --- role gating --------------------------------------------------------- */

describe("CommentsScreen — role gating (cosmetic)", () => {
  it("EDITOR: no email, no moderation actions, read-only detail", async () => {
    backend({ rows: [editorRow()] });
    const user = userEvent.setup();
    renderScreen("editor");

    await openMenu(user, "God is good");
    expect(await screen.findByRole("menuitem", { name: "View" })).toBeInTheDocument();
    for (const name of ["Hide", "Restore", "Dismiss reports", "Delete permanently"]) {
      expect(screen.queryByRole("menuitem", { name })).toBeNull();
    }
    expect(screen.queryByText("nii@example.com")).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Moderators handle hide and restore.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Hide" })).toBeNull();
  });

  it("MANAGER: sees the email, hide + dismiss on a visible reported row, restore on a hidden one, never delete", async () => {
    backend();
    const user = userEvent.setup();
    renderScreen("manager");

    expect((await screen.findAllByText("nii@example.com")).length).toBeGreaterThan(0);

    await openMenu(user, "God is good");
    expect(await screen.findByRole("menuitem", { name: "Hide" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Dismiss reports" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Restore" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete permanently" })).toBeNull();
    await user.keyboard("{Escape}");

    await openMenu(user, "Second comment");
    expect(await screen.findByRole("menuitem", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Hide" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete permanently" })).toBeNull();
  });

  it("ADMIN additionally sees Delete permanently", async () => {
    backend();
    const user = userEvent.setup();
    renderScreen("admin");
    await openMenu(user, "God is good");
    expect(
      await screen.findByRole("menuitem", { name: "Delete permanently" }),
    ).toBeInTheDocument();
  });
});

/* --- flows ---------------------------------------------------------------- */

describe("CommentsScreen — hide", () => {
  it("opens with the reason field focused (unlike the destructive Delete dialog)", async () => {
    backend();
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Hide" }));
    const dialog = await screen.findByRole("dialog", { name: "Hide this comment?" });

    expect(within(dialog).getByLabelText(/Reason/)).toHaveFocus();
  });

  it("requires a reason (no request is sent), then posts the trimmed reason", async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Hide" }));

    const dialog = await screen.findByRole("dialog", { name: "Hide this comment?" });
    await user.click(within(dialog).getByRole("button", { name: "Hide comment" }));
    expect(await within(dialog).findByText("Add a reason to continue.")).toBeInTheDocument();
    expect(calls.writes).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reason/), "  Spam link  ");
    await user.click(within(dialog).getByRole("button", { name: "Hide comment" }));

    expect(await screen.findByText("Comment hidden.")).toBeInTheDocument();
    expect(calls.writes).toEqual([
      { method: "POST", path: "/api/bff/admin/comments/c-1/hide", body: { reason: "Spam link" } },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("rejects a reason over 300 characters client-side", async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Hide" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste("a".repeat(301));
    await user.click(within(dialog).getByRole("button", { name: "Hide comment" }));

    expect(await within(dialog).findByText(/300 characters or fewer/)).toBeInTheDocument();
    expect(calls.writes).toHaveLength(0);
  });

  it("shows the server's 403 inside the dialog and keeps the input", async () => {
    const calls = backend({ failWrite: { match: "/hide", status: 403 } });
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Hide" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Reason/), "because");
    await user.click(within(dialog).getByRole("button", { name: "Hide comment" }));

    expect(
      await within(dialog).findByText("You don’t have permission to do this."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue("because");
    expect(calls.writes).toHaveLength(1);
  });
});

describe("CommentsScreen — restore", () => {
  it("restores directly with no confirm and no body, then toasts", async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "Second comment");
    await user.click(await screen.findByRole("menuitem", { name: "Restore" }));

    expect(await screen.findByText("Comment restored.")).toBeInTheDocument();
    expect(calls.writes).toEqual([
      { method: "POST", path: "/api/bff/admin/comments/c-2/restore", body: null },
    ]);
  });

  it("restores from the detail dialog too", async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderScreen("manager");

    await user.click(await screen.findByText("Second comment"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Auto-hidden at threshold")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    expect(await screen.findByText("Comment restored.")).toBeInTheDocument();
    expect(calls.writes[0].path).toBe("/api/bff/admin/comments/c-2/restore");
  });

  it("surfaces a 404 on restore as a page alert and refetches the list", async () => {
    const calls = backend({ failWrite: { match: "/restore", status: 404 } });
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "Second comment");
    await user.click(await screen.findByRole("menuitem", { name: "Restore" }));

    expect(await screen.findByText("This comment no longer exists.")).toBeInTheDocument();
    await waitFor(() => expect(calls.list.length).toBeGreaterThan(1));
  });

  it("disables the detail dialog's Restore button while the request is in flight, so a double click only sends one POST", async () => {
    const calls = backend();
    server.use(
      http.post("*/api/bff/admin/comments/*/restore", async ({ request }) => {
        calls.writes.push({
          method: "POST",
          path: new URL(request.url).pathname,
          body: null,
        });
        await delay(300);
        return HttpResponse.json(VISIBLE_REPORTED);
      }),
    );
    const user = userEvent.setup();
    renderScreen("manager");

    await user.click(await screen.findByText("Second comment"));
    const dialog = await screen.findByRole("dialog");
    const restoreButton = within(dialog).getByRole("button", { name: "Restore" });

    await user.click(restoreButton);
    expect(restoreButton).toBeDisabled();

    // Still pending: a second click must not fire a second request.
    await user.click(restoreButton);
    expect(calls.writes).toHaveLength(1);

    expect(await screen.findByText("Comment restored.")).toBeInTheDocument();
    expect(calls.writes).toHaveLength(1);
  });

  it("disables every other row's action menu items while a restore is in flight", async () => {
    backend();
    server.use(
      http.post("*/api/bff/admin/comments/*/restore", async () => {
        await delay(300);
        return HttpResponse.json(VISIBLE_REPORTED);
      }),
    );
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "Second comment");
    await user.click(await screen.findByRole("menuitem", { name: "Restore" }));

    // Enter the pending window, then open a different row's menu.
    await openMenu(user, "God is good");
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Hide" }),
    ).toHaveAttribute("data-disabled");
    expect(
      within(menu).getByRole("menuitem", { name: "Dismiss reports" }),
    ).toHaveAttribute("data-disabled");
  });
});

describe("CommentsScreen — dismiss reports", () => {
  it("requires a reason and posts it to dismiss-reports", async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Dismiss reports" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Dismiss reports" }));
    expect(await within(dialog).findByText("Add a reason to continue.")).toBeInTheDocument();
    expect(calls.writes).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reason/), "Reports were mistaken");
    await user.click(within(dialog).getByRole("button", { name: "Dismiss reports" }));

    expect(await screen.findByText("Reports dismissed.")).toBeInTheDocument();
    expect(calls.writes).toEqual([
      {
        method: "POST",
        path: "/api/bff/admin/comments/c-1/dismiss-reports",
        body: { reason: "Reports were mistaken" },
      },
    ]);
  });

  it("handles a 409 (comment was hidden meanwhile): message in the dialog, dialog stays, list refetched", async () => {
    const calls = backend({ failWrite: { match: "/dismiss-reports", status: 409 } });
    const user = userEvent.setup();
    renderScreen("manager");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Dismiss reports" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Reason/), "stale");
    await user.click(within(dialog).getByRole("button", { name: "Dismiss reports" }));

    expect(await within(dialog).findByText(/is hidden, so its reports can’t be dismissed/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(calls.list.length).toBeGreaterThan(1));
  });
});

describe("CommentsScreen — hard delete (ADMIN)", () => {
  it("needs a reason AND the confirm checkbox, then sends DELETE with a JSON body", async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderScreen("admin");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Delete this comment permanently?",
    });
    expect(within(dialog).getByText(/kept in the moderation log for 90 days/)).toBeInTheDocument();

    // Neither reason nor checkbox: both errors, no request.
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    expect(await within(dialog).findByText("Add a reason to continue.")).toBeInTheDocument();
    expect(calls.writes).toHaveLength(0);

    // Reason only: the checkbox still blocks.
    await user.type(within(dialog).getByLabelText(/Reason/), "Abusive");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    expect(await within(dialog).findByText("Tick the box to confirm.")).toBeInTheDocument();
    expect(calls.writes).toHaveLength(0);

    await user.click(within(dialog).getByRole("checkbox", { name: /I understand this is permanent/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    expect(await screen.findByText("Comment deleted.")).toBeInTheDocument();
    expect(calls.writes).toEqual([
      { method: "DELETE", path: "/api/bff/admin/comments/c-1", body: { reason: "Abusive" } },
    ]);
  });

  it("shows a stale-gate 403 from the server inside the dialog", async () => {
    backend({ failWrite: { match: "/c-1", status: 403 } });
    const user = userEvent.setup();
    renderScreen("admin");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Reason/), "x");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    expect(
      await within(dialog).findByText("You don’t have permission to do this."),
    ).toBeInTheDocument();
  });

  it("opens with Cancel focused, not the reason textarea, since Delete is destructive", async () => {
    backend();
    const user = userEvent.setup();
    renderScreen("admin");

    await openMenu(user, "God is good");
    await user.click(await screen.findByRole("menuitem", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Delete this comment permanently?",
    });

    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(dialog).getByLabelText(/Reason/)).not.toHaveFocus();
  });
});

/* --- pagination (ADM-UI-11) --------------------------------------------- */

describe("CommentsScreen — pagination", () => {
  it("page 1 requests offset=0 and limit=25", async () => {
    const calls = backend({ total: 60 });
    renderScreen("manager");
    await screen.findByText("God is good");

    expect(calls.list[0].get("limit")).toBe("25");
    expect(calls.list[0].get("offset")).toBe("0");
  });

  it("?page=2 requests offset=25 and ?page=3 requests offset=50", async () => {
    nav.search = new URLSearchParams("page=2");
    const second = backend({ total: 60 });
    const { unmount } = renderScreen("manager");
    await screen.findByText("God is good");
    expect(second.list[0].get("limit")).toBe("25");
    expect(second.list[0].get("offset")).toBe("25");
    unmount();

    nav.search = new URLSearchParams("page=3");
    const third = backend({ total: 60 });
    renderScreen("manager");
    await screen.findByText("God is good");
    expect(third.list[0].get("limit")).toBe("25");
    expect(third.list[0].get("offset")).toBe("50");
  });

  it("Next writes ?page=2; Previous from page 3 writes ?page=2; Previous from page 2 drops the param", async () => {
    const user = userEvent.setup();
    backend({ total: 60 });
    const first = renderScreen("manager");
    await screen.findByText("God is good");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/comments?page=2", {
      scroll: false,
    });
    first.unmount();

    nav.search = new URLSearchParams("page=3");
    backend({ total: 60 });
    const third = renderScreen("manager");
    await screen.findByText("God is good");
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/comments?page=2", {
      scroll: false,
    });
    third.unmount();

    nav.search = new URLSearchParams("page=2");
    backend({ total: 60 });
    renderScreen("manager");
    await screen.findByText("God is good");
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/comments", {
      scroll: false,
    });
  });

  it("does not rewrite an in-range ?page=2 (total 60), including while the request is pending", async () => {
    nav.search = new URLSearchParams("page=2");
    backend({ total: 60 });
    renderScreen("manager");
    expect(nav.replace).not.toHaveBeenCalled(); // mount, request in flight
    await screen.findByText("God is good");
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("clamps a page past the end back to the last real page", async () => {
    nav.search = new URLSearchParams("page=5");
    backend({ total: 30 }); // 2 pages
    renderScreen("manager");
    await screen.findByText("God is good");

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith("/comments?page=2", {
        scroll: false,
      }),
    );
  });

  it("clamps to page 1 (param dropped) when the total shrinks to a single page", async () => {
    nav.search = new URLSearchParams("page=3");
    backend({ total: 10 });
    renderScreen("manager");
    await screen.findByText("God is good");

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith("/comments", { scroll: false }),
    );
  });
});

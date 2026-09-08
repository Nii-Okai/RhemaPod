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
import { SermonsScreen } from "@/components/sermons/sermons-screen";
import { SermonRowMenu } from "@/components/sermons/sermon-row-menu";
import type { SermonListItem } from "@/lib/query/hooks/use-sermons";

/* W7 — the Sermons list, rendered (happy-dom). Every backend call is MSW, never
   a mocked fetch (§A.11). Covers: status→query mapping, filter change writes
   the URL and resets the page, the status/role row menu, the empty state, and
   an optimistic bulk submit that rolls back on a 500 with an alert. */

/* --- next/navigation + next/link, mocked ------------------------------- */

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
  usePathname: () => "/sermons",
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

/* --- happy-dom shims Radix's Popper needs ---------------------------- */

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
});
afterAll(() => server.close());

/* --- fixtures ------------------------------------------------------- */

const draftRow: SermonListItem = {
  id: "s-1",
  title: "The Prodigal Son",
  description: null,
  status: "draft",
  tier: "free",
  duration_seconds: 1862,
  speaker_id: "spk-1",
  speaker_name: "Ada Grace",
  series_id: null,
  series_title: null,
  episode_number: null,
  category_id: null,
  category_name: null,
  thumbnail_url: null,
  locked: false,
  created_by: "u-1",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-05T10:00:00Z",
};

const page = (items: SermonListItem[], total = items.length) => ({
  items,
  total,
  limit: 25,
  offset: 0,
});

interface ListHandlerOptions {
  rows?: SermonListItem[];
  /** Reported `total` for the list query (drives pageCount). Defaults to
      `rows.length`. Set it higher than `rows.length` to model a page deep in a
      large list without listing every row. */
  total?: number;
  onList?: (query: URLSearchParams) => void;
}

/** One `/api/bff/sermons` handler that serves BOTH the list query and the
    `limit=1` count probes, plus empty speakers/series. */
function backend({ rows = [draftRow], total, onList }: ListHandlerOptions = {}) {
  server.use(
    http.get("*/api/bff/speakers", () => HttpResponse.json([])),
    http.get("*/api/bff/series", () => HttpResponse.json([])),
    http.get("*/api/bff/sermons", ({ request }) => {
      const query = new URL(request.url).searchParams;
      if (query.get("limit") === "1") {
        // count probe
        return HttpResponse.json(page([], 0));
      }
      onList?.(query);
      return HttpResponse.json(page(rows, total ?? rows.length));
    }),
  );
}

/** happy-dom has no `window.confirm`; stub it for a test body. */
function stubConfirm(result = true): () => void {
  const original = window.confirm;
  window.confirm = vi.fn(() => result);
  return () => {
    window.confirm = original;
  };
}

function renderScreen(role = "editor") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider
        user={{ id: "u-1", email: "e@x.dev", name: "Ed", role }}
      >
        <SermonsScreen />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

/* --- tests -------------------------------------------------------------- */

describe("SermonsScreen — status → query mapping", () => {
  it("the 'Drafts' tab issues one request with status=draft, limit=25", async () => {
    nav.search = new URLSearchParams("status=drafts");
    const listCalls: string[] = [];
    backend({ onList: (q) => listCalls.push(`${q.get("status")}|${q.get("limit")}`) });

    renderScreen();
    await screen.findByText("The Prodigal Son");

    expect(listCalls).toEqual(["draft|25"]);
  });

  it("the 'In review' tab issues both pending_review and under_review requests", async () => {
    nav.search = new URLSearchParams("status=in-review");
    const statuses: string[] = [];
    backend({
      rows: [],
      onList: (q) => {
        const s = q.get("status");
        if (s) statuses.push(s);
      },
    });

    renderScreen();
    await screen.findByText("No sermons match these filters.");

    expect(new Set(statuses)).toEqual(
      new Set(["pending_review", "under_review"]),
    );
  });
});

describe("SermonsScreen — filter bar writes the URL", () => {
  it("changing the status resets the page and replaces (not pushes) history", async () => {
    nav.search = new URLSearchParams("status=drafts&page=3");
    backend({ total: 100 }); // page 3 is well within range → no clamp

    renderScreen();
    await screen.findByText("The Prodigal Son");

    await userEvent.click(screen.getByRole("radio", { name: "Published" }));

    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledTimes(1);
    const href = nav.replace.mock.calls[0][0];
    expect(href).toContain("status=published");
    expect(href).not.toContain("page=");
  });
});

describe("SermonsScreen — empty state", () => {
  it("renders 'No sermons yet' when the list is empty on the default view", async () => {
    nav.search = new URLSearchParams();
    backend({ rows: [] });

    renderScreen();

    expect(await screen.findByText("No sermons yet")).toBeInTheDocument();
    expect(
      screen.getByText("Draft your first sermon, then submit it for review."),
    ).toBeInTheDocument();
  });
});

describe("SermonsScreen — optimistic bulk submit + rollback", () => {
  it("flips the badge to Pending review, then rolls back to Draft and shows an alert carrying the backend detail + correlation id on a 500", async () => {
    nav.search = new URLSearchParams("status=drafts");
    backend();
    server.use(
      http.post("*/api/bff/sermons/s-1/submit", async () => {
        await delay(40);
        return HttpResponse.json(
          { detail: "Sermon has no media", correlation_id: "cid-9f2a" },
          { status: 409 },
        );
      }),
    );

    renderScreen();
    await screen.findByText("The Prodigal Son");
    expect(screen.getByText("Draft")).toBeInTheDocument();

    // Select the row → the header swaps for the clay bulk bar.
    await userEvent.click(screen.getAllByLabelText("Select row")[0]);
    await userEvent.click(
      screen.getByRole("button", { name: "Submit for review" }),
    );

    // Optimistic patch.
    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    // Rollback + alert.
    expect(await screen.findByText("Draft")).toBeInTheDocument();
    expect(
      await screen.findByText("That action didn’t go through"),
    ).toBeInTheDocument();

    // The alert must surface the backend reason AND the support ref — not just
    // the sermon title (regression: mutation.onError was dead code, so
    // ApiError.detail / .correlationId were dropped from every failure).
    const alertText = await screen.findByText(
      /Couldn’t submit “The Prodigal Son”\./,
    );
    expect(alertText).toHaveTextContent("Sermon has no media");
    expect(alertText).toHaveTextContent("reference: cid-9f2a");
  });

  it("partial bulk delete: the rows that succeeded stay gone, the one that failed stays, and the alert names it", async () => {
    nav.search = new URLSearchParams("status=drafts");
    const all: SermonListItem[] = [
      { ...draftRow, id: "s-1", title: "Alpha" },
      { ...draftRow, id: "s-2", title: "Bravo" },
      { ...draftRow, id: "s-3", title: "Charlie" },
    ];
    const deleted = new Set<string>();
    server.use(
      http.get("*/api/bff/speakers", () => HttpResponse.json([])),
      http.get("*/api/bff/series", () => HttpResponse.json([])),
      http.get("*/api/bff/sermons", ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (query.get("limit") === "1") return HttpResponse.json(page([], 0));
        const live = all.filter((r) => !deleted.has(r.id));
        return HttpResponse.json(page(live, live.length));
      }),
      http.delete("*/api/bff/sermons/s-1", () => {
        deleted.add("s-1");
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete("*/api/bff/sermons/s-3", () => {
        deleted.add("s-3");
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete("*/api/bff/sermons/s-2", async () => {
        await delay(20);
        return HttpResponse.json(
          { detail: "Sermon is locked", correlation_id: "cid-lock" },
          { status: 409 },
        );
      }),
    );

    const restoreConfirm = stubConfirm(true);
    try {
      renderScreen();
      await screen.findByText("Alpha");

      await userEvent.click(
        screen.getByRole("checkbox", { name: "Select all rows" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));

      // The alert is set in the same tick the per-row reconcile runs, so once
      // it's on screen the succeeded/failed split has been applied.
      const alertText = await screen.findByText(/Couldn’t delete “Bravo”\./);
      expect(alertText).toHaveTextContent("Sermon is locked");
      expect(alertText).toHaveTextContent("reference: cid-lock");

      // Final reconciled state: the two that succeeded stay gone (no rollback
      // flash + re-vanish), the one that failed stays put.
      await vi.waitFor(() => {
        expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
        expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
        expect(screen.getByText("Bravo")).toBeInTheDocument();
      });
    } finally {
      restoreConfirm();
    }
  });
});

describe("SermonsScreen — bulk submit reflects the eligible count", () => {
  it("labels the button with N when only some of the selected rows are eligible", async () => {
    nav.search = new URLSearchParams();
    backend({
      rows: [
        { ...draftRow, id: "s-1", title: "Draft one", status: "draft" },
        { ...draftRow, id: "s-2", title: "Published one", status: "published" },
      ],
    });

    renderScreen();
    await screen.findByText("Draft one");

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    );

    // 1 of 2 selected is submittable → the count is on the button.
    expect(
      await screen.findByRole("button", { name: "Submit 1 for review" }),
    ).toBeInTheDocument();
  });
});

describe("SermonsScreen — row menu gated while a mutation is in flight", () => {
  it("disables another row's menu actions while workflow.isPending, so a 2nd onMutate can't snapshot the 1st's optimistic state", async () => {
    nav.search = new URLSearchParams("status=drafts");
    backend({
      rows: [
        { ...draftRow, id: "s-1", title: "Alpha" },
        { ...draftRow, id: "s-2", title: "Bravo" },
      ],
    });
    server.use(
      http.post("*/api/bff/sermons/s-1/submit", async () => {
        await delay(300);
        return HttpResponse.json({ detail: "ok" });
      }),
    );

    renderScreen();
    await screen.findByText("Alpha");

    // Submit Alpha from the bulk bar → enter the pending window.
    await userEvent.click(screen.getAllByLabelText("Select row")[0]);
    await userEvent.click(
      screen.getByRole("button", { name: "Submit for review" }),
    );
    await screen.findByText("Pending review"); // optimistic → mutation pending

    // Bravo is still a draft; its menu's mutating items must be disabled.
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Bravo" }),
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Submit for review" }),
    ).toHaveAttribute("data-disabled");
    expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).toHaveAttribute("data-disabled");
  });
});

describe("SermonsScreen — page clamp after the last page empties", () => {
  it("drops to the last real page and replaces the URL when the current page is beyond the end", async () => {
    // URL asks for page 3; the backend only has 10 rows (1 page of 25).
    nav.search = new URLSearchParams("page=3");
    backend({
      rows: Array.from({ length: 10 }, (_, i) => ({
        ...draftRow,
        id: `s-${i}`,
        title: `Sermon ${i}`,
      })),
    });

    renderScreen();

    await vi.waitFor(() => {
      expect(nav.replace).toHaveBeenCalled();
    });
    const href = nav.replace.mock.calls.at(-1)![0];
    expect(href).not.toContain("page=");
  });
});

describe("SermonRowMenu — status/role matrix (rendered)", () => {
  const openMenu = (status: SermonListItem["status"], role: string) => {
    render(
      <SermonRowMenu
        sermonId="s-1"
        title="Test"
        status={status}
        role={role}
        onAction={() => {}}
        defaultOpen
      />,
    );
    return screen.getByRole("menu");
  };

  it("(draft, editor) → Edit · Submit for review · Delete", () => {
    const menu = openMenu("draft", "editor");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Edit", "Submit for review", "Delete"]);
  });

  it("(published, manager) → Edit · Unpublish", () => {
    const menu = openMenu("published", "manager");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Edit", "Unpublish"]);
  });

  it("(under_review, editor) → Edit (locked) · Withdraw, disabled", () => {
    const menu = openMenu("under_review", "editor");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Edit (locked)",
      "Withdraw",
    ]);
    expect(items[1]).toHaveAttribute("data-disabled");
  });
});

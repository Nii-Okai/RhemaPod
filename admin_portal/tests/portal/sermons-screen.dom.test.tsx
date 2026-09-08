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
  onList?: (query: URLSearchParams) => void;
}

/** One `/api/bff/sermons` handler that serves BOTH the list query and the
    `limit=1` count probes, plus empty speakers/series. */
function backend({ rows = [draftRow], onList }: ListHandlerOptions = {}) {
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
      return HttpResponse.json(page(rows));
    }),
  );
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
    backend();

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
  it("flips the badge to Pending review, then rolls back to Draft and shows an alert on a 500", async () => {
    nav.search = new URLSearchParams("status=drafts");
    backend();
    server.use(
      http.post("*/api/bff/sermons/s-1/submit", async () => {
        await delay(40);
        return HttpResponse.json(
          { detail: "Nope", correlation_id: "cid-9" },
          { status: 500 },
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
    const alert = await screen.findByText("That action didn’t go through");
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByText(/Couldn’t submit “The Prodigal Son”/),
    ).toBeInTheDocument();
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

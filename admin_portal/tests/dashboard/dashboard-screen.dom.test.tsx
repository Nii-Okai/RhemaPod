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
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import type { SermonListItem } from "@/lib/query/hooks/use-dashboard";

/* W23 — the reduced Dashboard, both role variants, rendered (happy-dom). Every
   backend call is MSW (plan §A.11). The `showAnalytics` prop stands in for the
   server-resolved role branch (`page.tsx` sets it from `getServerUser()`;
   `dashboard-page.test.tsx` proves that). This file proves what each variant
   renders and, critically, what the editor variant never fetches. */

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

const ANALYTICS_PATHS = [
  "/admin/analytics/overview",
  "/admin/analytics/top-sermons",
  "/admin/analytics/new-listeners",
] as const;

/* --- fixtures ------------------------------------------------------- */

const sermon = (over: Partial<SermonListItem>): SermonListItem => ({
  id: "s-1",
  title: "Untitled",
  status: "draft",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-08T09:00:00Z",
  created_by: "u-1",
  description: null,
  duration_seconds: null,
  episode_number: null,
  locked: false,
  category_id: null,
  series_id: null,
  speaker_id: null,
  thumbnail_url: null,
  tier: "free",
  ...over,
});

const DRAFTS = [
  sermon({ id: "d-1", title: "The Weight of Mercy", status: "draft" }),
  sermon({ id: "d-2", title: "Anchored: Part Two", status: "draft" }),
];

// Eight rejected sermons — the WIP tile must still fetch AT MOST 5 logs.
const REJECTED = Array.from({ length: 8 }, (_, i) =>
  sermon({ id: `r-${i + 1}`, title: `Rejected ${i + 1}`, status: "rejected" }),
);

const IN_FLIGHT = [
  {
    id: "j-1",
    sermon_id: "d-2",
    media_type: "video",
    status: "processing",
    original_filename: "anchored-pt2.mp4",
    content_type: "video/mp4",
    size_bytes: 1024,
    created_at: "2026-09-09T08:00:00Z",
    error_message: null,
  },
];

const OVERVIEW = {
  total_plays: 18402,
  completion_rate: 0.61,
  active_subscribers: 1240,
  published_sermons: 96,
  total_users: 5000,
  unique_viewers: 3100,
  completions: 200,
  plays_last_7_days: 400,
};

const TOP_SERMONS = [
  { sermon_id: "s-1", title: "Anchored: Part One", plays: 3102, completions: 1, completion_rate: 0.7, unique_viewers: 900 },
  { sermon_id: "s-2", title: "Bread for the Journey", plays: 2284, completions: 1, completion_rate: 0.6, unique_viewers: 700 },
];

const BUCKETS = [3, 3, 3, 3, 3, 0, 3, 3].map((count, i) => ({
  week_start: `2026-06-${String(1 + i * 7).padStart(2, "0")}`,
  count,
}));

/* --- MSW wiring --------------------------------------------------- */

interface Spies {
  sermonQueries: URLSearchParams[];
  logHits: string[];
  analyticsHits: string[];
}

function backend(): Spies {
  const spies: Spies = { sermonQueries: [], logHits: [], analyticsHits: [] };

  server.use(
    http.get("*/api/bff/sermons", ({ request }) => {
      const q = new URL(request.url).searchParams;
      spies.sermonQueries.push(q);
      const status = q.get("status");
      const items =
        status === "draft" ? DRAFTS : status === "rejected" ? REJECTED : [];
      return HttpResponse.json({
        items,
        total: items.length,
        limit: 5,
        offset: 0,
      });
    }),
    http.get("*/api/bff/uploads/in-flight", () => HttpResponse.json(IN_FLIGHT)),
    http.get(
      "*/api/bff/approvals/sermons/:sermonId/approval-log",
      ({ params }) => {
        spies.logHits.push(String(params.sermonId));
        return HttpResponse.json([
          {
            actor_id: "a-1",
            actor_name: null,
            from_status: "under_review",
            to_status: "rejected",
            note: `Tighten the close on ${params.sermonId}`,
            created_at: "2026-09-08T10:00:00Z",
          },
        ]);
      },
    ),
    http.get("*/api/bff/admin/analytics/overview", () => {
      spies.analyticsHits.push("overview");
      return HttpResponse.json(OVERVIEW);
    }),
    http.get("*/api/bff/admin/analytics/top-sermons", () => {
      spies.analyticsHits.push("top-sermons");
      return HttpResponse.json(TOP_SERMONS);
    }),
    http.get("*/api/bff/admin/analytics/new-listeners", () => {
      spies.analyticsHits.push("new-listeners");
      return HttpResponse.json(BUCKETS);
    }),
  );

  return spies;
}

function renderDashboard(showAnalytics: boolean, firstName: string | null = "Ada") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardScreen firstName={firstName} showAnalytics={showAnalytics} />
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/* --- editor variant -------------------------------------------- */

describe("DashboardScreen — editor variant", () => {
  it("renders the greeting and all three WIP cards", async () => {
    backend();
    renderDashboard(false);

    expect(
      screen.getByRole("heading", { name: "Good morning, Ada" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Your work in progress")).toBeInTheDocument();

    await screen.findByText("The Weight of Mercy");
    expect(document.querySelector('[data-wip="drafts"]')).toBeInTheDocument();
    expect(
      document.querySelector('[data-wip="processing"]'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-wip="rejected"]')).toBeInTheDocument();

    expect(screen.getByTestId("wip-count-drafts")).toHaveTextContent("2");
    expect(screen.getByTestId("wip-count-rejected")).toHaveTextContent("8");
  });

  it("puts NO analytics blocks in the markup — absent, not hidden", async () => {
    backend();
    const { container } = renderDashboard(false);
    await screen.findByText("The Weight of Mercy");

    expect(
      container.querySelector('[data-slot="dashboard-analytics"]'),
    ).toBeNull();
    expect(container.querySelector('[data-slot="stat-card"]')).toBeNull();
    expect(
      container.querySelector('[data-slot="new-listeners-card"]'),
    ).toBeNull();
    expect(screen.queryByText("New listeners")).not.toBeInTheDocument();
    expect(screen.queryByText("Top sermons")).not.toBeInTheDocument();
  });

  it("issues ZERO requests to the three /admin/analytics/* routes", async () => {
    const spies = backend();
    renderDashboard(false);
    await screen.findByText("The Weight of Mercy");
    // let any stray query flush
    await new Promise((r) => setTimeout(r, 50));

    expect(spies.analyticsHits).toEqual([]);
    for (const path of ANALYTICS_PATHS) {
      expect(
        spies.sermonQueries.every((q) => !q.toString().includes(path)),
      ).toBe(true);
    }
  });

  it("scopes the WIP sermon reads to the caller (created_by=me on the wire)", async () => {
    const spies = backend();
    renderDashboard(false);
    await screen.findByText("The Weight of Mercy");

    const byStatus = (s: string) =>
      spies.sermonQueries.find((q) => q.get("status") === s);
    expect(byStatus("draft")?.get("created_by")).toBe("me");
    expect(byStatus("rejected")?.get("created_by")).toBe("me");
  });

  it("caps approval-log fetches at 5 even with 8 rejected sermons", async () => {
    const spies = backend();
    renderDashboard(false);

    await screen.findByText("Rejected 1");
    await vi.waitFor(() => expect(spies.logHits.length).toBe(5));
    await new Promise((r) => setTimeout(r, 50));
    expect(spies.logHits.length).toBe(5);
    expect(new Set(spies.logHits)).toEqual(
      new Set(["r-1", "r-2", "r-3", "r-4", "r-5"]),
    );
  });
});

/* --- manager / admin variant ---------------------------------- */

describe("DashboardScreen — manager/admin variant", () => {
  it("renders WIP cards plus the four tiles, the chart and top sermons", async () => {
    backend();
    const { container } = renderDashboard(true);

    await screen.findByText("The Weight of Mercy");
    await screen.findByText("Anchored: Part One"); // top-sermons row

    expect(screen.getByText("New listeners")).toBeInTheDocument();
    expect(screen.getByText("last 8 weeks")).toBeInTheDocument();
    expect(screen.getByText("Top sermons")).toBeInTheDocument();

    expect(screen.getByTestId("stat-tile-total-plays")).toHaveTextContent(
      "18,402",
    );
    expect(screen.getByTestId("stat-tile-completion-rate")).toHaveTextContent(
      "61%",
    );
    expect(screen.getByTestId("stat-tile-paid-members")).toHaveTextContent(
      "1,240",
    );
    expect(
      screen.getByTestId("stat-tile-published-sermons"),
    ).toHaveTextContent("96");

    // 8 zero-filled buckets, one bar + one label per bucket.
    expect(
      container.querySelectorAll('[data-slot="bar-chart-bar"]'),
    ).toHaveLength(8);
    expect(
      container.querySelectorAll('[data-slot="bar-chart-label"]'),
    ).toHaveLength(8);
  });

  it("renders the tiles BARE — label + number only, no delta / % change / 'of N total'", async () => {
    backend();
    const { container } = renderDashboard(true);
    await screen.findByText("The Weight of Mercy");

    const tiles = Array.from(
      container.querySelectorAll('[data-slot="stat-card"]'),
    );
    expect(tiles).toHaveLength(4);

    for (const tile of tiles) {
      // Exactly the eyebrow label span + the metric span — no third node.
      expect(tile.querySelectorAll(":scope > span")).toHaveLength(2);
      const text = tile.textContent ?? "";
      expect(text).not.toMatch(/of\s+\d[\d,]*\s+total/i);
      expect(text).not.toMatch(/this month/i);
      expect(text).not.toMatch(/\bpts\b/i);
      expect(text).not.toMatch(/[+−]\s?\d/); // "+12.4%", "−3"
      // the StatCard delta line's movement colours
      expect(tile.querySelector(".text-sage-text, .text-rose-text")).toBeNull();
    }
  });

  it("labels the chart 'New listeners' and never says 'plays' around it", async () => {
    backend();
    const { container } = renderDashboard(true);
    await screen.findByText("New listeners");

    const card = container.querySelector(
      '[data-slot="new-listeners-card"]',
    ) as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(within(card).queryByText(/plays/i)).not.toBeInTheDocument();
    expect(
      within(card).getByRole("img", { name: /New listeners/i }),
    ).toBeInTheDocument();
  });
});

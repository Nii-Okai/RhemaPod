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
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SeriesGrid } from "@/components/series/series-grid";

/* W11 — the Series manager card grid, rendered (happy-dom). Every backend call
   is MSW (§A.11). Covers: cards from the list, the "N episodes · category"
   footer derivation, the dashed New-series tile, and the empty state. */

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

const SERIES = [
  {
    id: "ser-faith",
    title: "Walking in Faith",
    description: "A journey through Hebrews 11.",
    category_id: "cat-teaching",
    tier: "paid",
    status: "published",
    thumbnail_url: null,
  },
  {
    id: "ser-basics",
    title: "Sunday Basics",
    description: null,
    category_id: null,
    tier: "free",
    status: "draft",
    thumbnail_url: null,
  },
];

const CATEGORIES = [
  { id: "cat-teaching", name: "Teaching", slug: "teaching", sermon_count: 0 },
  { id: "cat-youth", name: "Youth", slug: "youth", sermon_count: 0 },
];

interface BackendOptions {
  series?: unknown[];
  /** series_id → episode `total` for the count probe. */
  counts?: Record<string, number>;
}

function backend({ series = SERIES, counts = {} }: BackendOptions = {}) {
  server.use(
    http.get("*/api/bff/series", () => HttpResponse.json(series)),
    http.get("*/api/bff/categories", () => HttpResponse.json(CATEGORIES)),
    http.get("*/api/bff/sermons", ({ request }) => {
      const q = new URL(request.url).searchParams;
      const sid = q.get("series_id") ?? "";
      return HttpResponse.json({
        items: [],
        total: counts[sid] ?? 0,
        limit: 1,
        offset: 0,
      });
    }),
  );
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SeriesGrid />
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("SeriesGrid", () => {
  it("renders a card per series with the derived 'N episodes · category' footer", async () => {
    backend({ counts: { "ser-faith": 3, "ser-basics": 1 } });
    renderGrid();

    expect(await screen.findByText("Walking in Faith")).toBeInTheDocument();
    expect(screen.getByText("Sunday Basics")).toBeInTheDocument();

    // faith: 3 episodes, category cat-teaching → "Teaching"
    expect(await screen.findByText("3 episodes · Teaching")).toBeInTheDocument();
    // basics: 1 episode (singular), no category → "Uncategorized"
    expect(
      await screen.findByText("1 episode · Uncategorized"),
    ).toBeInTheDocument();

    // Manage links point at the detail route.
    const manage = screen.getAllByRole("link", { name: "Manage" });
    expect(manage[0]).toHaveAttribute("href", "/series/ser-faith");
  });

  it("always renders the dashed New-series tile after the cards", async () => {
    backend();
    renderGrid();
    await screen.findByText("Walking in Faith");

    const tile = screen.getByRole("link", { name: /New series/ });
    expect(tile).toHaveAttribute("href", "/series/new");
  });

  it("shows the empty state (no lone dashed tile) when there are no series", async () => {
    backend({ series: [] });
    renderGrid();

    expect(await screen.findByText("No series yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "New series" }),
    ).toHaveAttribute("href", "/series/new");
  });
});

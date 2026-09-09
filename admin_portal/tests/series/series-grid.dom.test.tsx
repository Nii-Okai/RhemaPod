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

/* W11 / Batch 5 — the Series manager card grid, rendered (happy-dom). Every
   backend call is MSW (§A.11). Covers: cards from the list, the
   "N episodes · category" footer read straight off `episode_count` /
   `category_name` on the DTO (no per-card probe, no categories-list join), the
   dashed New-series tile, and the empty state. */

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
    category_name: "Teaching",
    tier: "paid",
    status: "published",
    thumbnail_url: null,
    episode_count: 3,
  },
  {
    id: "ser-basics",
    title: "Sunday Basics",
    description: null,
    category_id: null,
    category_name: null,
    tier: "free",
    status: "draft",
    thumbnail_url: null,
    episode_count: 1,
  },
];

interface BackendOptions {
  series?: unknown[];
}

function backend({ series = SERIES }: BackendOptions = {}) {
  server.use(
    http.get("*/api/bff/series", () => HttpResponse.json(series)),
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
  it("renders a card per series with the 'N episodes · category' footer from the DTO", async () => {
    backend();
    renderGrid();

    expect(await screen.findByText("Walking in Faith")).toBeInTheDocument();
    expect(screen.getByText("Sunday Basics")).toBeInTheDocument();

    // faith: episode_count 3, category_name "Teaching"
    expect(screen.getByText("3 episodes · Teaching")).toBeInTheDocument();
    // basics: episode_count 1 (singular), category_name null → "Uncategorized"
    expect(screen.getByText("1 episode · Uncategorized")).toBeInTheDocument();

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

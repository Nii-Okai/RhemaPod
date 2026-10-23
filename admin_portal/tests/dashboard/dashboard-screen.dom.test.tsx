import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";

/* The Dashboard, both role variants, rendered (happy-dom). Every backend call
   is MSW (plan §A.11). `showAnalytics` stands in for the server-resolved role
   branch (`dashboard-page.test.tsx` proves that). This file proves what each
   variant shows, that every number is the backend's, and what the editor
   variant never fetches. */

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

const COUNTS = {
  draft: 3, pending_review: 2, under_review: 1, approved: 0,
  published: 12, rejected: 1, unpublished: 0, total: 19,
};

const OVERVIEW = {
  total_users: 60, members: 50, active_members: 48, active_subscribers: 7,
  published_sermons: 12, total_plays: 1234, unique_viewers: 40, completions: 30,
  completion_rate: 0.61, plays_last_7_days: 20, watch_hours: 88.5,
};

function report(from: string, to: string, kpis: Record<string, number>, since: string | null) {
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d < new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return {
    period: { from, to, granularity: "day" },
    data_available_from: since,
    kpis: { completions: 0, watch_hours: 0, new_listeners: 0, ...kpis },
    series: days.map((start, i) => {
      const end = days[i + 1] ?? to;
      return {
        start, end, plays: i === days.length - 1 ? kpis.plays : 0, completions: 0,
        watch_hours: 0, listeners: 0, new_listeners: 0, signups: 0,
      };
    }),
    top_sermons: [{ sermon_id: "s-1", title: "Anchored: Part One", plays: kpis.plays, completions: 0, watch_hours: 0 }],
  };
}

interface Spies {
  analytics: string[];
  counts: URLSearchParams[];
}

function backend({ coverPrevious }: { coverPrevious: boolean }): Spies {
  const spies: Spies = { analytics: [], counts: [] };
  server.use(
    http.get("*/api/bff/sermons/status-counts", ({ request }) => {
      spies.counts.push(new URL(request.url).searchParams);
      return HttpResponse.json(COUNTS);
    }),
    http.get("*/api/bff/admin/analytics/overview", () => {
      spies.analytics.push("overview");
      return HttpResponse.json(OVERVIEW);
    }),
    http.get("*/api/bff/admin/analytics/report", ({ request }) => {
      spies.analytics.push("report");
      const q = new URL(request.url).searchParams;
      const from = q.get("from")!;
      const to = q.get("to")!;
      const isCurrent = q.get("granularity") === "day";
      const since = coverPrevious ? "2020-01-01" : to;
      return HttpResponse.json(
        isCurrent
          ? report(from, to, { plays: 150, listeners: 30, signups: 6 }, coverPrevious ? since : "2020-01-01")
          : report(from, to, { plays: 100, listeners: 30, signups: 4 }, since),
      );
    }),
  );
  return spies;
}

function renderDashboard(showAnalytics: boolean, now = new Date("2026-10-23T09:00:00Z")) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardScreen firstName="Ada" showAnalytics={showAnalytics} now={now} />
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("DashboardScreen — header", () => {
  it("greets by the time of day in Ghana and has no subtitle", () => {
    backend({ coverPrevious: true });
    renderDashboard(false, new Date("2026-10-23T18:30:00Z"));
    const heading = screen.getByRole("heading", { name: "Good evening, Ada" });
    expect(heading.parentElement?.querySelector("p")).toBeNull();
    expect(screen.queryByText(/Your unfinished work/)).toBeNull();
    expect(screen.queryByText("Work in progress")).toBeNull();
  });
});

describe("DashboardScreen — editor variant", () => {
  it("shows their sermon pipeline and never calls the analytics routes", async () => {
    const spies = backend({ coverPrevious: true });
    renderDashboard(false);

    expect(await screen.findByText("19 sermons")).toBeInTheDocument();
    const drafts = document.querySelector('[data-status="draft"]')!;
    expect(within(drafts as HTMLElement).getByText("3")).toBeInTheDocument();
    expect(drafts.getAttribute("href")).toBe("/sermons?status=drafts");
    expect(spies.analytics).toEqual([]);
  });
});

describe("DashboardScreen — manager/admin variant", () => {
  it("shows the backend's 30-day figures, compared with the 30 days before", async () => {
    backend({ coverPrevious: true });
    renderDashboard(true);

    const plays = await screen.findByTestId("stat-tile-plays");
    expect(await within(plays).findByText("150")).toBeInTheDocument();
    expect(within(plays).getByText("50% vs previous 30 days")).toBeInTheDocument();
    const members = screen.getByTestId("stat-tile-new-members");
    expect(within(members).getByText("6")).toBeInTheDocument();
    expect(within(members).getByText("50% vs previous 30 days")).toBeInTheDocument();
    expect(within(screen.getByTestId("stat-tile-paid-members")).getByText("7")).toBeInTheDocument();
    // pending_review + under_review
    expect(within(screen.getByTestId("stat-tile-awaiting-review")).getByText("3")).toBeInTheDocument();

    const allTime = document.querySelector('[data-slot="all-time-card"]') as HTMLElement;
    expect(within(allTime).getByText("1,234")).toBeInTheDocument();
    expect(within(allTime).getByText("61%")).toBeInTheDocument();
    expect(within(allTime).getByText("48 active of 50")).toBeInTheDocument();
    expect(screen.getByText("Anchored: Part One")).toBeInTheDocument();
  });

  it("drops the change line for rollup figures the earlier window didn't record", async () => {
    backend({ coverPrevious: false });
    renderDashboard(true);

    const plays = await screen.findByTestId("stat-tile-plays");
    await within(plays).findByText("150");
    expect(within(plays).queryByText(/vs previous/)).toBeNull();
    // Signups come from full history, so they still compare.
    const members = screen.getByTestId("stat-tile-new-members");
    expect(await within(members).findByText("50% vs previous 30 days")).toBeInTheDocument();
  });
});

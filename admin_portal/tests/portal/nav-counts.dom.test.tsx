import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { queryKeys } from "@/lib/query/keys";
import { useNavCounts } from "@/lib/query/hooks/use-nav-counts";

/* Bugfix batch #1 — the sidebar counts must be right for the NEW session
   immediately after a fresh sign-in, not one F5 later.

   The browser `QueryClient` is a singleton that outlives a sign-out → sign-in
   round trip, so the two guards this asserts are:
     - the login-success handler invalidates every `nav` key, and `useNavCounts`
       refetches when that happens;
     - `useNavCounts` revalidates on mount even when the singleton still holds a
       previous session's (time-fresh) cached counts.

   On the wire through MSW (§A.11), never a mocked fetch. */

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** The three count endpoints, served from a mutable holder so a test can swap
    the numbers mid-run and prove a refetch picked them up. */
function counts(next: () => { sermons: number; series: number; review: number }) {
  server.use(
    http.get("*/api/bff/sermons", () => {
      const n = next().sermons;
      return HttpResponse.json({ items: [], total: n, limit: 1, offset: 0 });
    }),
    http.get("*/api/bff/series", () =>
      HttpResponse.json(new Array(next().series).fill({ id: "s" })),
    ),
    http.get("*/api/bff/approvals/sermons/review-queue", () => {
      const n = next().review;
      return HttpResponse.json({ items: [], total: n, limit: 1, offset: 0 });
    }),
  );
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useNavCounts — fresh-session refetch", () => {
  it("refetches the counts when the `nav` keys are invalidated (the login-success path)", async () => {
    let current = { sermons: 2, series: 1, review: 0 };
    counts(() => current);

    const client = makeClient();
    const { result } = renderHook(() => useNavCounts(), {
      wrapper: wrapper(client),
    });

    await waitFor(() =>
      expect(result.current).toEqual({ sermons: 2, series: 1, reviewQueue: 0 }),
    );

    // New session signs in → the login form drops every `nav` key.
    current = { sermons: 9, series: 4, review: 3 };
    await client.invalidateQueries({ queryKey: queryKeys.nav.all() });

    await waitFor(() =>
      expect(result.current).toEqual({ sermons: 9, series: 4, reviewQueue: 3 }),
    );
  });

  it("revalidates on mount even when the singleton still holds a prior session's cached counts", async () => {
    // A previous session left time-fresh counts in the shared client.
    const client = makeClient();
    client.setQueryData(queryKeys.nav.counts(), {
      sermons: 99,
      series: 99,
      reviewQueue: 99,
    });

    counts(() => ({ sermons: 5, series: 2, review: 1 }));

    const { result } = renderHook(() => useNavCounts(), {
      wrapper: wrapper(client),
    });

    await waitFor(() =>
      expect(result.current).toEqual({ sermons: 5, series: 2, reviewQueue: 1 }),
    );
  });
});

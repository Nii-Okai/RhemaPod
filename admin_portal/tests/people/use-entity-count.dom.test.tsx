import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { queryKeys } from "@/lib/query/keys";
import {
  entityCountLabel,
  useEntityCount,
} from "@/lib/query/hooks/use-entity-count";

/* W12 — the mono "N sermons" figure on a speaker row / category pill. No DTO
   field for it (→ [GATE 3 Batch 5]), so it is a `limit=1` `total` probe keyed
   under the sermons domain. Asserted on the wire through MSW (§A.11):
   `—` while loading → the number, and a `sermons.lists()` invalidation refetches
   it (a detach must be able to move the count). */

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useEntityCount", () => {
  it("probes speaker_id + limit=1, renders — then the total, and refetches on a sermons.lists() invalidation", async () => {
    const seen: Array<Record<string, string>> = [];
    let total = 3;
    server.use(
      http.get("*/api/bff/sermons", ({ request }) => {
        const q = new URL(request.url).searchParams;
        seen.push({
          speaker_id: q.get("speaker_id") ?? "",
          limit: q.get("limit") ?? "",
        });
        return HttpResponse.json({ items: [], total, limit: 1, offset: 0 });
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(() => useEntityCount("speaker", "spk-1"), {
      wrapper: makeWrapper(client),
    });

    // Loading — the cell renders an em dash, never 0.
    expect(result.current.data).toBeUndefined();
    expect(entityCountLabel(result.current.data)).toBe("—");

    await waitFor(() => expect(result.current.data).toBe(3));
    expect(seen[0]).toEqual({ speaker_id: "spk-1", limit: "1" });

    // A detach elsewhere invalidates the whole sermons list sub-tree; this
    // probe lives under it, so it must refetch and pick up the new total.
    total = 5;
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
    });
    await waitFor(() => expect(result.current.data).toBe(5));
    expect(seen).toHaveLength(2);
  });

  it("makes no request for a non-persisted id — the create-mode '' and the optimistic-create sentinel are both suppressed", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*/api/bff/sermons", ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ items: [], total: 0, limit: 1, offset: 0 });
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrap = makeWrapper(client);

    const empty = renderHook(() => useEntityCount("category", ""), {
      wrapper: wrap,
    });
    const optimistic = renderHook(
      () => useEntityCount("speaker", "optimistic:1e2d3c4b"),
      { wrapper: wrap },
    );

    // The query never leaves idle and the probe URL is never hit.
    expect(empty.result.current.fetchStatus).toBe("idle");
    expect(optimistic.result.current.fetchStatus).toBe("idle");
    expect(empty.result.current.data).toBeUndefined();
    expect(entityCountLabel(optimistic.result.current.data)).toBe("—");

    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([]);
  });

  it("uses category_id for the category kind", async () => {
    const seen: Array<Record<string, string>> = [];
    server.use(
      http.get("*/api/bff/sermons", ({ request }) => {
        const q = new URL(request.url).searchParams;
        seen.push({
          category_id: q.get("category_id") ?? "",
          limit: q.get("limit") ?? "",
        });
        return HttpResponse.json({ items: [], total: 7, limit: 1, offset: 0 });
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(() => useEntityCount("category", "cat-9"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.data).toBe(7));
    expect(seen[0]).toEqual({ category_id: "cat-9", limit: "1" });
  });
});

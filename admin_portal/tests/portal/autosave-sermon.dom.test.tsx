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
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { useAutosaveSermon } from "@/lib/query/hooks/use-autosave-sermon";

/* W8 — the autosave engine (plan §A.4). Every backend call is MSW, never a
   mocked fetch (§A.11).

   The first test proves the 2s debounce window with FAKE timers. The rest run
   on real timers with a short injected `debounceMs` (a testability seam on the
   hook) so `waitFor` works — mixing `waitFor` with fake timers deadlocks.

   Covers: rapid edits → ONE coalesced PATCH at 2s; blur/flush → immediate
   save; /sermons/new first-save POSTs then flips to PATCH-mode against the new
   id; a failed save → status "error" + a message, the edit is NOT dropped and
   retries on the next flush. */

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

describe("useAutosaveSermon — debounce window (fake timers)", () => {
  it("coalesces rapid edits into ONE PATCH, fired 2s after the last change", async () => {
    vi.useFakeTimers();
    const patches: Array<Record<string, unknown>> = [];
    server.use(
      http.patch("*/api/bff/sermons/s-1", async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: "s-1", title: "x" });
      }),
    );

    const { result } = renderHook(
      () => useAutosaveSermon({ sermonId: "s-1", onCreated: vi.fn() }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "A" }));
    act(() => result.current.queue({ title: "AB" }));
    act(() => result.current.queue({ description: "body" }));
    expect(result.current.status).toBe("saving");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(patches).toHaveLength(0); // still inside the debounce

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(patches).toEqual([{ title: "AB", description: "body" }]);
    expect(result.current.status).toBe("saved");
    expect(result.current.savedAt).toBeGreaterThan(0);
  });
});

describe("useAutosaveSermon — flush", () => {
  it("flush() saves immediately and cancels the pending debounce", async () => {
    let calls = 0;
    server.use(
      http.patch("*/api/bff/sermons/s-1", async () => {
        calls += 1;
        return HttpResponse.json({ id: "s-1", title: "x" });
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: "s-1",
          onCreated: vi.fn(),
          debounceMs: 10_000,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "Blur me" }));
    act(() => result.current.flush());

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(calls).toBe(1);

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1); // the 10s debounce never got to fire a second one
  });
});

describe("useAutosaveSermon — new → edit transition", () => {
  it("first save POSTs, calls onCreated(newId), then PATCHes the new id", async () => {
    let posted: Record<string, unknown> | null = null;
    const patchedIds: string[] = [];
    server.use(
      http.post("*/api/bff/sermons", async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { id: "new-42", title: posted.title },
          { status: 201 },
        );
      }),
      http.patch("*/api/bff/sermons/new-42", async ({ request }) => {
        await request.json();
        patchedIds.push("new-42");
        return HttpResponse.json({ id: "new-42", title: "x" });
      }),
    );

    const onCreated = vi.fn();
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) =>
        useAutosaveSermon({ sermonId: id, onCreated, debounceMs: 15 }),
      { wrapper, initialProps: { id: undefined as string | undefined } },
    );

    // No title yet → nothing fires even after the debounce elapses.
    act(() => result.current.queue({ description: "just a body" }));
    await new Promise((r) => setTimeout(r, 40));
    expect(onCreated).not.toHaveBeenCalled();

    // Add a title → the POST goes, carrying the earlier description too.
    act(() => result.current.queue({ title: "My first sermon" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-42"));
    expect(posted).toEqual({
      description: "just a body",
      title: "My first sermon",
    });

    // The route replaces the URL; the prop catches up.
    rerender({ id: "new-42" });

    act(() => result.current.queue({ title: "Renamed" }));
    await waitFor(() => expect(patchedIds).toEqual(["new-42"]));
  });
});

describe("useAutosaveSermon — a failed save keeps the edit", () => {
  it("goes to status 'error' with a message and retries on the next flush", async () => {
    let attempt = 0;
    server.use(
      http.patch("*/api/bff/sermons/s-9", async () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            { detail: "Sermon is locked", correlation_id: "cid-77" },
            { status: 409 },
          );
        }
        return HttpResponse.json({ id: "s-9", title: "ok" });
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: "s-9",
          onCreated: vi.fn(),
          debounceMs: 15,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "try one" }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toContain("Sermon is locked");
    expect(result.current.errorMessage).toContain("reference: cid-77");
    expect(result.current.isDirty).toBe(true);

    // Retry — the failed payload is still pending, so no new queue() needed.
    act(() => result.current.flush());
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(attempt).toBe(2);
    expect(result.current.isDirty).toBe(false);
  });
});

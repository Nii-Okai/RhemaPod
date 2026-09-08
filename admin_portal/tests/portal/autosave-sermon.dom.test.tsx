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
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { useAutosaveSermon } from "@/lib/query/hooks/use-autosave-sermon";

/* W8 — the autosave engine (plan §A.4), the concurrency review surface.
   Every backend call is MSW, never a mocked fetch (§A.11).

   The first test proves the 2s debounce window with FAKE timers. The rest run
   on real timers with short injected `debounceMs` / `retryMs` (testability
   seams on the hook) so `waitFor` works — mixing `waitFor` with fake timers
   deadlocks.

   Each claim is written so it can actually fail: request counts are asserted
   with `toHaveBeenCalledTimes` / exact-array equality, never
   `toHaveBeenCalled()`. */

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

/* --- 1. debounce coalescing (fake timers) ----------------------------- */

describe("useAutosaveSermon — debounce window (fake timers)", () => {
  it("coalesces rapid edits into exactly ONE PATCH, fired 2s after the last change", async () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    server.use(
      http.patch("*/api/bff/sermons/s-1", async ({ request }) => {
        patch((await request.json()) as Record<string, unknown>);
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
    expect(patch).not.toHaveBeenCalled(); // still inside the debounce

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ title: "AB", description: "body" });
    expect(result.current.status).toBe("saved");
    expect(result.current.savedAt).toBeGreaterThan(0);
  });
});

/* --- 2. flush cancels the pending debounce --------------------------- */

describe("useAutosaveSermon — flush cancels the pending debounce", () => {
  it("queues an edit, flushes before the timer, then advances past it → ONE PATCH", async () => {
    const patch = vi.fn();
    server.use(
      http.patch("*/api/bff/sermons/s-2", async ({ request }) => {
        patch((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: "s-2" });
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: "s-2",
          onCreated: vi.fn(),
          debounceMs: 50,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "typed" }));
    act(() => {
      void result.current.flush();
    });

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(patch).toHaveBeenCalledTimes(1);

    await sleep(120); // well past the 50ms debounce
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

/* --- 3. two flush() in one synchronous tick ------------------------- */

describe("useAutosaveSermon — two flush() in one tick", () => {
  it("simulates blur + Save-draft click → exactly one request", async () => {
    const patch = vi.fn();
    server.use(
      http.patch("*/api/bff/sermons/s-3", async ({ request }) => {
        patch((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: "s-3" });
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: "s-3",
          onCreated: vi.fn(),
          debounceMs: 10_000,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "Blur then Save" }));
    act(() => {
      void result.current.flush();
      void result.current.flush();
    });

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(patch).toHaveBeenCalledTimes(1);

    await sleep(20);
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

/* --- 4. edit DURING the in-flight create POST ---------------------- */

describe("useAutosaveSermon — edit during the in-flight create POST", () => {
  it("PATCHes the new id from onCreated, drops nothing, never PATCHes a null id", async () => {
    const postBody = vi.fn();
    const patchedIds: string[] = [];
    const patchBodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/api/bff/sermons", async ({ request }) => {
        postBody((await request.json()) as Record<string, unknown>);
        await delay(60); // hold the create open so an edit can land mid-flight
        return HttpResponse.json({ id: "new-7", title: "t" }, { status: 201 });
      }),
      http.patch("*/api/bff/sermons/:id", async ({ request, params }) => {
        patchedIds.push(params.id as string);
        patchBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: params.id });
      }),
    );

    const onCreated = vi.fn();
    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: undefined,
          onCreated,
          debounceMs: 10,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "Fresh" }));
    await sleep(25); // the POST is now in flight (60ms delay)
    act(() => result.current.queue({ description: "added mid-flight" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-7"));
    await waitFor(() => expect(patchedIds).toEqual(["new-7"]));

    expect(postBody).toHaveBeenCalledTimes(1);
    expect(postBody).toHaveBeenCalledWith({ title: "Fresh" });
    // the coalesced follow-up carried the mid-flight edit, against the new id
    expect(patchBodies).toEqual([{ description: "added mid-flight" }]);
    expect(patchedIds).not.toContain("undefined");
    await waitFor(() => expect(result.current.status).toBe("saved"));
  });
});

/* --- 5. failed save, then re-edit the SAME field before the retry --- */

describe("useAutosaveSermon — retry sends the newer value", () => {
  it("re-editing the failed field before the retrigger makes the retry send the new value", async () => {
    let attempt = 0;
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.patch("*/api/bff/sermons/s-5", async ({ request }) => {
        attempt += 1;
        bodies.push((await request.json()) as Record<string, unknown>);
        if (attempt === 1) {
          return HttpResponse.json(
            { detail: "Conflict", correlation_id: "c-5" },
            { status: 409 },
          );
        }
        return HttpResponse.json({ id: "s-5" });
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: "s-5",
          onCreated: vi.fn(),
          debounceMs: 10,
          retryMs: 10_000, // keep the auto-retry out of this test
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "v1" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(bodies).toEqual([{ title: "v1" }]);
    expect(result.current.isDirty).toBe(true);

    // Re-edit the same field before any retrigger — pins the
    // `{ ...payload, ...pendingRef.current }` precedence.
    act(() => result.current.queue({ title: "v2" }));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    expect(attempt).toBe(2);
    expect(bodies[1]).toEqual({ title: "v2" });
    expect(result.current.isDirty).toBe(false);
  });
});

/* --- 6. transient 5xx → one automatic retry, then success ---------- */

describe("useAutosaveSermon — auto-retry on a transient failure", () => {
  it("a 5xx schedules exactly one automatic retry, with no user action, and it succeeds", async () => {
    let attempt = 0;
    server.use(
      http.patch("*/api/bff/sermons/s-6", async () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            { detail: "Upstream down", correlation_id: "c-6" },
            { status: 503 },
          );
        }
        return HttpResponse.json({ id: "s-6" });
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: "s-6",
          onCreated: vi.fn(),
          debounceMs: 10,
          retryMs: 200,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "hi" }));

    // The first attempt fails; observe the error state before the retry window
    // (200ms) closes — poll fast so the transient state is caught.
    await waitFor(() => expect(result.current.status).toBe("error"), {
      interval: 10,
    });
    expect(attempt).toBe(1);

    // No queue(), no flush() — the scheduled retry alone recovers it.
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(attempt).toBe(2);
    expect(result.current.isDirty).toBe(false);

    // And it stops at one automatic attempt — nothing fires a third.
    await sleep(120);
    expect(attempt).toBe(2);
  });
});

/* --- 7. a 4xx is never auto-retried ------------------------------- */

describe("useAutosaveSermon — a 4xx is never auto-retried", () => {
  it("holds at 'error' past the retry window until a user action", async () => {
    let attempt = 0;
    server.use(
      http.patch("*/api/bff/sermons/s-7", async () => {
        attempt += 1;
        return HttpResponse.json(
          { detail: "Bad request", correlation_id: "c-7" },
          { status: 400 },
        );
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: "s-7",
          onCreated: vi.fn(),
          debounceMs: 10,
          retryMs: 15,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ title: "x" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(attempt).toBe(1);

    await sleep(60); // well past retryMs — a 4xx must not self-retry
    expect(attempt).toBe(1);
    expect(result.current.status).toBe("error");
  });
});

/* --- 8. create-mode with no title: nothing fires, no "Saving…" ---- */

describe("useAutosaveSermon — create-mode before a title exists", () => {
  it("holds the edits, never POSTs, and does not flash 'Saving…'", async () => {
    const post = vi.fn();
    server.use(
      http.post("*/api/bff/sermons", async () => {
        post();
        return HttpResponse.json({ id: "n" }, { status: 201 });
      }),
    );

    const { result } = renderHook(
      () =>
        useAutosaveSermon({
          sermonId: undefined,
          onCreated: vi.fn(),
          debounceMs: 10,
        }),
      { wrapper },
    );

    act(() => result.current.queue({ description: "body only" }));
    expect(result.current.status).toBe("idle"); // no "saving" flash
    expect(result.current.isDirty).toBe(true);

    await sleep(40);
    expect(post).not.toHaveBeenCalled();
  });
});

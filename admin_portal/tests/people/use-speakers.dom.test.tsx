import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { queryKeys } from "@/lib/query/keys";
import {
  useDeleteSpeaker,
  useUpdateSpeaker,
  type Speaker,
} from "@/lib/query/hooks/use-speakers";

/* W12 review pass — the speaker write hooks' optimistic behaviour, asserted on
   the cached list directly (the panel renders the same list). Every backend
   call is MSW (§A.11):
     - useUpdateSpeaker: optimistic merge before the PATCH resolves, rollback on
       error, and a `byName` re-sort when the patch renames the row.
     - useDeleteSpeaker: per-id rollback — a failed delete restores only its own
       row, so a *concurrent* delete's optimistic removal is not resurrected. */

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const listKey = queryKeys.speakers.list();

const SEED: Speaker[] = [
  { id: "spk-a", name: "Ada Grace", bio: "Lead pastor.", sermon_count: 4 },
  { id: "spk-b", name: "Bem Okoro", bio: null, sermon_count: 0 },
];

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

const namesIn = (client: QueryClient) =>
  (client.getQueryData<Speaker[]>(listKey) ?? []).map((s) => s.name);
const idsIn = (client: QueryClient) =>
  (client.getQueryData<Speaker[]>(listKey) ?? []).map((s) => s.id);

describe("useUpdateSpeaker — optimistic edit", () => {
  it("merges the patch into the cached list before the PATCH resolves", async () => {
    server.use(
      http.patch("*/api/bff/speakers/:id", async ({ params, request }) => {
        await delay(40);
        const patch = (await request.json()) as Partial<Speaker>;
        const base = SEED.find((s) => s.id === params.id)!;
        return HttpResponse.json({ ...base, ...patch });
      }),
    );
    const client = makeClient();
    client.setQueryData(
      listKey,
      SEED.map((s) => ({ ...s })),
    );
    const { result } = renderHook(() => useUpdateSpeaker(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "spk-a", patch: { bio: "New bio." } });
    });

    // Optimistic — the cache carries the new bio while the request is still open.
    await waitFor(() =>
      expect(
        client
          .getQueryData<Speaker[]>(listKey)!
          .find((s) => s.id === "spk-a")!.bio,
      ).toBe("New bio."),
    );
    expect(result.current.isPending).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      client.getQueryData<Speaker[]>(listKey)!.find((s) => s.id === "spk-a")!
        .bio,
    ).toBe("New bio.");
  });

  it("rolls the merge back when the PATCH fails", async () => {
    server.use(
      http.patch("*/api/bff/speakers/:id", () =>
        HttpResponse.json(
          { detail: "still referenced", correlation_id: "cid-x" },
          { status: 500 },
        ),
      ),
    );
    const client = makeClient();
    client.setQueryData(
      listKey,
      SEED.map((s) => ({ ...s })),
    );
    const { result } = renderHook(() => useUpdateSpeaker(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "spk-a", patch: { name: "Ada Renamed" } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(namesIn(client)).toEqual(["Ada Grace", "Bem Okoro"]);
  });

  it("re-sorts the list by name when the patch renames the row", async () => {
    server.use(
      http.patch("*/api/bff/speakers/:id", async ({ params, request }) => {
        await delay(40);
        const patch = (await request.json()) as Partial<Speaker>;
        const base = SEED.find((s) => s.id === params.id)!;
        return HttpResponse.json({ ...base, ...patch });
      }),
    );
    const client = makeClient();
    client.setQueryData(
      listKey,
      SEED.map((s) => ({ ...s })),
    ); // [Ada Grace, Bem Okoro]
    const { result } = renderHook(() => useUpdateSpeaker(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "spk-a", patch: { name: "Zeb Adams" } });
    });

    await waitFor(() =>
      expect(namesIn(client)).toEqual(["Bem Okoro", "Zeb Adams"]),
    );
  });
});

describe("useDeleteSpeaker — concurrent deletes", () => {
  it("rolls back only the failed id, leaving a concurrent delete's removal intact", async () => {
    const seed: Speaker[] = [
      { id: "spk-a", name: "Ada Grace", bio: null, sermon_count: 0 },
      { id: "spk-b", name: "Bem Okoro", bio: null, sermon_count: 0 },
      { id: "spk-c", name: "Cara New", bio: null, sermon_count: 0 },
    ];
    server.use(
      http.delete("*/api/bff/speakers/:id", async ({ params }) => {
        // Long enough that both optimistic removals land before either
        // response — that is the race: spk-b's onMutate snapshots the list
        // with spk-a already gone.
        await delay(150);
        if (params.id === "spk-a") {
          return HttpResponse.json(
            { detail: "still referenced", correlation_id: "cid-a" },
            { status: 500 },
          );
        }
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const client = makeClient();
    client.setQueryData(
      listKey,
      seed.map((s) => ({ ...s })),
    );
    const { result } = renderHook(() => useDeleteSpeaker(), {
      wrapper: wrapper(client),
    });

    // Fire both before either resolves: spk-b's onMutate snapshots the list
    // *after* spk-a is already optimistically gone.
    act(() => {
      result.current.mutate("spk-a"); // → 500
      result.current.mutate("spk-b"); // → 204
    });
    await waitFor(() => expect(idsIn(client)).toEqual(["spk-c"]));

    // spk-a's failure restores only spk-a; spk-b stays removed. A whole-list
    // snapshot rollback would have resurrected spk-b here (→ ["spk-a","spk-b","spk-c"]).
    await waitFor(() => expect(idsIn(client)).toEqual(["spk-a", "spk-c"]));
  });
});

import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { queryKeys } from "@/lib/query/keys";
import {
  useUpdateCategory,
  type Category,
} from "@/lib/query/hooks/use-categories";

/* W12 review pass — `useUpdateCategory`'s optimistic `setQueryData` path
   (create-409 and delete were already covered, update was not). Asserted on the
   cached list directly; every backend call is MSW (§A.11): the optimistic merge
   lands before the PATCH resolves, rolls back on error, and re-sorts by name
   when the patch renames the category. */

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const listKey = queryKeys.categories.list();

const SEED: Category[] = [
  { id: "cat-a", name: "Teaching", slug: "teaching", sermon_count: 3 },
  { id: "cat-b", name: "Worship", slug: "worship", sermon_count: 0 },
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
  (client.getQueryData<Category[]>(listKey) ?? []).map((c) => c.name);

describe("useUpdateCategory — optimistic edit", () => {
  it("merges the patch into the cached list before the PATCH resolves", async () => {
    server.use(
      http.patch("*/api/bff/categories/:id", async ({ params, request }) => {
        await delay(40);
        const patch = (await request.json()) as Partial<Category>;
        const base = SEED.find((c) => c.id === params.id)!;
        return HttpResponse.json({ ...base, ...patch });
      }),
    );
    const client = makeClient();
    client.setQueryData(
      listKey,
      SEED.map((c) => ({ ...c })),
    );
    const { result } = renderHook(() => useUpdateCategory(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "cat-a", patch: { slug: "teachings" } });
    });

    await waitFor(() =>
      expect(
        client
          .getQueryData<Category[]>(listKey)!
          .find((c) => c.id === "cat-a")!.slug,
      ).toBe("teachings"),
    );
    expect(result.current.isPending).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      client.getQueryData<Category[]>(listKey)!.find((c) => c.id === "cat-a")!
        .slug,
    ).toBe("teachings");
  });

  it("rolls the merge back when the PATCH fails", async () => {
    server.use(
      http.patch("*/api/bff/categories/:id", () =>
        HttpResponse.json(
          { detail: "server error", correlation_id: "cid-y" },
          { status: 500 },
        ),
      ),
    );
    const client = makeClient();
    client.setQueryData(
      listKey,
      SEED.map((c) => ({ ...c })),
    );
    const { result } = renderHook(() => useUpdateCategory(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "cat-a", patch: { name: "Teachings" } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(namesIn(client)).toEqual(["Teaching", "Worship"]);
  });

  it("re-sorts the list by name when the patch renames the category", async () => {
    server.use(
      http.patch("*/api/bff/categories/:id", async ({ params, request }) => {
        await delay(40);
        const patch = (await request.json()) as Partial<Category>;
        const base = SEED.find((c) => c.id === params.id)!;
        return HttpResponse.json({ ...base, ...patch });
      }),
    );
    const client = makeClient();
    client.setQueryData(
      listKey,
      SEED.map((c) => ({ ...c })),
    ); // [Teaching, Worship]
    const { result } = renderHook(() => useUpdateCategory(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "cat-a", patch: { name: "Zephaniah" } });
    });

    await waitFor(() =>
      expect(namesIn(client)).toEqual(["Worship", "Zephaniah"]),
    );
  });
});

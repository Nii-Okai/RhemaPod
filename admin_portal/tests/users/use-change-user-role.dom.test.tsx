import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { queryKeys } from "@/lib/query/keys";
import {
  USERS_PAGE_SIZE,
  useChangeUserRole,
  type UserPage,
  type UserPublic,
} from "@/lib/query/hooks/use-users";

/* W17 review pass — the inline role change's optimistic cache write, asserted
   on the cached list pages directly (§A.11, every backend call is MSW). The
   screen renders straight off these pages, so an optimistic role that no
   longer matches a page's `?role=` filter is a visible wrong-state flash until
   `onSettled` refetches. `onMutate` must drop the row from a page it no longer
   matches, not leave it there with a mismatched chip. */

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const editorPageKey = queryKeys.users.list({
  role: "editor",
  limit: USERS_PAGE_SIZE,
  offset: 0,
});
const allPageKey = queryKeys.users.list({
  limit: USERS_PAGE_SIZE,
  offset: 0,
});

const row = (over: Partial<UserPublic>): UserPublic => ({
  id: "u-1",
  email: "u1@rhemapod.church",
  full_name: "User One",
  role: "editor",
  is_active: true,
  has_password: false,
  linked_providers: [],
  created_at: "2024-06-21T10:00:00Z",
  ...over,
});

const ADA = row({ id: "u-ed", email: "ada@rhemapod.church", full_name: "Ada Nwosu", role: "editor" });
const BEN = row({ id: "u-ed2", email: "ben@rhemapod.church", full_name: "Ben Cole", role: "editor" });
const DAN = row({ id: "u-mgr", email: "dan@rhemapod.church", full_name: "Dan Okoye", role: "manager" });

const page = (items: UserPublic[], total: number): UserPage => ({
  items: items.map((u) => ({ ...u })),
  total,
  limit: USERS_PAGE_SIZE,
  offset: 0,
});

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

const idsIn = (client: QueryClient, key: readonly unknown[]) =>
  (client.getQueryData<UserPage>(key)?.items ?? []).map((u) => u.id);
const roleOf = (client: QueryClient, key: readonly unknown[], id: string) =>
  client.getQueryData<UserPage>(key)?.items.find((u) => u.id === id)?.role;
const totalOf = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryData<UserPage>(key)?.total;

describe("useChangeUserRole — optimistic filter-drop", () => {
  it("drops the row from a page whose ?role= no longer matches, before the PATCH settles", async () => {
    server.use(
      http.patch("*/api/bff/users/:id/role", async ({ params, request }) => {
        await delay(40);
        const body = (await request.json()) as { role: UserPublic["role"] };
        return HttpResponse.json({ ...ADA, id: String(params.id), role: body.role });
      }),
    );

    const client = makeClient();
    client.setQueryData(editorPageKey, page([ADA, BEN], 2));
    client.setQueryData(allPageKey, page([ADA, BEN, DAN], 3));

    const { result } = renderHook(() => useChangeUserRole(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "u-ed", role: "manager" });
    });

    // Optimistic, while the request is still open:
    await waitFor(() => {
      // Editors page (?role=editor) — Ada no longer matches, so she is gone,
      // not sitting there showing "Manager". `total` follows.
      expect(idsIn(client, editorPageKey)).toEqual(["u-ed2"]);
      expect(totalOf(client, editorPageKey)).toBe(1);
    });
    // The unfiltered "all" page keeps her, with the new role.
    expect(idsIn(client, allPageKey)).toEqual(["u-ed", "u-ed2", "u-mgr"]);
    expect(roleOf(client, allPageKey, "u-ed")).toBe("manager");
    expect(totalOf(client, allPageKey)).toBe(3);

    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("a rejected change restores both pages verbatim", async () => {
    server.use(
      http.patch("*/api/bff/users/:id/role", async () => {
        await delay(20);
        return HttpResponse.json(
          { detail: "You are not permitted to assign the 'manager' role" },
          { status: 400 },
        );
      }),
    );

    const client = makeClient();
    client.setQueryData(editorPageKey, page([ADA, BEN], 2));
    client.setQueryData(allPageKey, page([ADA, BEN, DAN], 3));

    const { result } = renderHook(() => useChangeUserRole(), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ id: "u-ed", role: "manager" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(idsIn(client, editorPageKey)).toEqual(["u-ed", "u-ed2"]);
    expect(roleOf(client, editorPageKey, "u-ed")).toBe("editor");
    expect(totalOf(client, editorPageKey)).toBe(2);
    expect(roleOf(client, allPageKey, "u-ed")).toBe("editor");
    expect(totalOf(client, allPageKey)).toBe(3);
  });
});

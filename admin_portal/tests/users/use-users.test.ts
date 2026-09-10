import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
  USERS_PAGE_SIZE,
  loadRoleCounts,
  loadUsers,
  toRoleFilter,
} from "@/lib/query/hooks/use-users";

import { server } from "../msw/server";

/* W17 / Batch 7 — the Users & roles read models, asserted on the wire through
   MSW (plan §A.11), never a mocked fetch. Covers: the staff list `role` /
   `limit` / `offset` params (and that `role` is omitted for "all"), and the
   full-table `role-counts` shape that feeds the Viewers tile. */

const ORIGIN = "http://localhost";
const client = createApiClient({ baseUrl: `${ORIGIN}/api/bff` });

const emptyPage = { items: [], total: 0, limit: USERS_PAGE_SIZE, offset: 0 };

let seen: URLSearchParams[];

beforeEach(() => {
  seen = [];
  server.use(
    http.get(`${ORIGIN}/api/bff/users`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(emptyPage);
    }),
    http.get(`${ORIGIN}/api/bff/users/role-counts`, () =>
      HttpResponse.json({
        viewer: 4812,
        editor: 6,
        manager: 2,
        admin: 2,
        total: 4822,
      }),
    ),
  );
});

afterEach(() => server.resetHandlers());

describe("toRoleFilter", () => {
  it("keeps the three staff roles and rejects everything else — viewer included", () => {
    expect(toRoleFilter("editor")).toBe("editor");
    expect(toRoleFilter("manager")).toBe("manager");
    expect(toRoleFilter("admin")).toBe("admin");
    expect(toRoleFilter("viewer")).toBe("all");
    expect(toRoleFilter(null)).toBe("all");
    expect(toRoleFilter("garbage")).toBe("all");
  });
});

describe("loadUsers", () => {
  it("omits `role` for the 'all' filter and sends the page window", async () => {
    await loadUsers({ role: "all", page: 1 }, client);

    expect(seen).toHaveLength(1);
    expect(seen[0].has("role")).toBe(false);
    expect(seen[0].get("limit")).toBe(String(USERS_PAGE_SIZE));
    expect(seen[0].get("offset")).toBe("0");
  });

  it("passes `role=editor` through and offsets by page", async () => {
    await loadUsers({ role: "editor", page: 3 }, client);

    expect(seen[0].get("role")).toBe("editor");
    expect(seen[0].get("offset")).toBe(String(2 * USERS_PAGE_SIZE));
  });

  it("clamps a junk page to 1", async () => {
    await loadUsers({ role: "manager", page: 0 }, client);
    expect(seen[0].get("offset")).toBe("0");
    expect(seen[0].get("role")).toBe("manager");
  });
});

describe("loadRoleCounts", () => {
  it("returns the full-table aggregate, viewer bucket included", async () => {
    await expect(loadRoleCounts(client)).resolves.toEqual({
      viewer: 4812,
      editor: 6,
      manager: 2,
      admin: 2,
      total: 4822,
    });
  });
});

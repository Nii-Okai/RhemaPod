import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../msw/server";
import { createApiClient } from "@/lib/api/client";
import { loadAnnouncements } from "@/lib/query/hooks/use-announcements";
import { pathToTarget } from "@/lib/query/hooks/use-announcement-publish";
import type { AnnouncementStatus } from "@/lib/query/hooks/use-announcements";

/* W13 — the admin-list transport. Assert on the wire (the `status`/`limit`/
   `offset` params and the `Page` envelope) through MSW, never a mocked fetch
   (plan §A.11). Plus `pathToTarget`, the pure "shortest legal path to
   published" the editor's Publish button walks. */

const client = createApiClient({ baseUrl: "http://localhost/api/bff" });

const envelope = (offset: number) => ({
  items: [],
  total: 7,
  limit: 25,
  offset,
});

afterEach(() => server.resetHandlers());

describe("loadAnnouncements", () => {
  it("page 1, status 'all' → limit=25, offset=0, NO status param", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/bff/announcements/admin/all", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json(envelope(0));
      }),
    );

    const page = await loadAnnouncements({ status: "all", page: 1 }, client);

    expect(seen!.get("limit")).toBe("25");
    expect(seen!.get("offset")).toBe("0");
    expect(seen!.has("status")).toBe(false);
    expect(page.total).toBe(7);
  });

  it("a status filter is sent through; page N → offset (N-1)*25", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/bff/announcements/admin/all", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json(envelope(50));
      }),
    );

    await loadAnnouncements({ status: "pending_review", page: 3 }, client);

    expect(seen!.get("status")).toBe("pending_review");
    expect(seen!.get("offset")).toBe("50");
  });

  it("clamps a junk page to 1", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/bff/announcements/admin/all", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json(envelope(0));
      }),
    );

    await loadAnnouncements({ status: "all", page: 0 }, client);

    expect(seen!.get("offset")).toBe("0");
  });
});

describe("pathToTarget", () => {
  it("editor 'submit' target: only draft/rejected have a step", () => {
    expect(pathToTarget("draft", "submit")).toEqual(["submit"]);
    expect(pathToTarget("rejected", "submit")).toEqual(["submit"]);
    for (const s of [
      "pending_review",
      "approved",
      "published",
      "archived",
    ] as AnnouncementStatus[]) {
      expect(pathToTarget(s, "submit")).toEqual([]);
    }
  });

  it("manager 'publish' target: shortest legal path to published", () => {
    expect(pathToTarget("draft", "publish")).toEqual([
      "submit",
      "approve",
      "publish",
    ]);
    expect(pathToTarget("rejected", "publish")).toEqual([
      "submit",
      "approve",
      "publish",
    ]);
    expect(pathToTarget("pending_review", "publish")).toEqual([
      "approve",
      "publish",
    ]);
    expect(pathToTarget("approved", "publish")).toEqual(["publish"]);
    expect(pathToTarget("archived", "publish")).toEqual(["publish"]);
    expect(pathToTarget("published", "publish")).toEqual([]);
  });
});

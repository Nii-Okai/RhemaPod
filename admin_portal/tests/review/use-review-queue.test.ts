import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../msw/server";
import { createApiClient } from "@/lib/api/client";
import { loadReviewQueue } from "@/lib/query/hooks/use-review-queue";

/* The Review queue transport (W10). Assert on the wire — the `limit`/`offset`
   params and the `Page[ReviewQueueItem]` envelope — through MSW, never a mocked
   fetch (plan §A.11). */

const client = createApiClient({ baseUrl: "http://localhost/api/bff" });

const envelope = (offset: number) => ({
  items: [
    {
      id: "00000000-0000-0000-0000-0000000000a1",
      title: "Grace upon grace",
      description: "A study of John 1.",
      duration_seconds: 1902,
      speaker_id: null,
      speaker_name: "Ada Grace",
      category_id: null,
      category_name: "Teaching",
      series_id: null,
      series_title: null,
      tier: "free",
      status: "pending_review",
      submitted_at: "2026-09-05T09:00:00Z",
      renditions_ready: 2,
      review_claimed_by: null,
    },
  ],
  total: 30,
  limit: 25,
  offset,
});

afterEach(() => server.resetHandlers());

describe("loadReviewQueue", () => {
  it("requests limit=25, offset=0 for page 1 and unwraps the envelope", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/bff/approvals/sermons/review-queue", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json(envelope(0));
      }),
    );

    const page = await loadReviewQueue(1, client);

    expect(seen!.get("limit")).toBe("25");
    expect(seen!.get("offset")).toBe("0");
    expect(page.total).toBe(30);
    expect(page.items[0].title).toBe("Grace upon grace");
  });

  it("maps page N to offset (N-1)*25", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/bff/approvals/sermons/review-queue", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json(envelope(50));
      }),
    );

    await loadReviewQueue(3, client);

    expect(seen!.get("offset")).toBe("50");
  });

  it("clamps a junk page to 1 (offset 0)", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/bff/approvals/sermons/review-queue", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json(envelope(0));
      }),
    );

    await loadReviewQueue(0, client);

    expect(seen!.get("offset")).toBe("0");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";

import { server } from "../msw/server";
import { createApiClient } from "@/lib/api/client";
import { loadSermonStream } from "@/lib/query/hooks/use-sermon-stream";

/* `loadSermonStream`'s transport (gilfoyle nit, round 2): `useSermonStream`'s
   `queryFn` never forwarded TanStack Query's `{ signal }` into the underlying
   `client.GET` call, so an unmounted review-queue card's in-flight stream
   fetch could never actually abort. Assert on the wire — through MSW, never a
   mocked fetch (plan §A.11) — that the signal now reaches the request. */

const client = createApiClient({ baseUrl: "http://localhost/api/bff" });

const SERMON_ID = "11111111-1111-1111-1111-111111111111";

afterEach(() => server.resetHandlers());

describe("loadSermonStream", () => {
  it("unwraps the StreamResponse envelope", async () => {
    server.use(
      http.get(`*/api/bff/sermons/${SERMON_ID}/stream`, () =>
        HttpResponse.json({
          sermon_id: SERMON_ID,
          expires_in: 3600,
          variants: [
            { quality: "720p", type: "video", url: "https://cdn.test/a.mp4" },
          ],
        }),
      ),
    );

    const res = await loadSermonStream(SERMON_ID, client);
    expect(res.variants[0].url).toBe("https://cdn.test/a.mp4");
  });

  it("forwards an AbortSignal through to the request — aborting rejects with AbortError, never lets a stale response land", async () => {
    server.use(
      http.get(`*/api/bff/sermons/${SERMON_ID}/stream`, async () => {
        await delay(1000);
        return HttpResponse.json({
          sermon_id: SERMON_ID,
          expires_in: 3600,
          variants: [],
        });
      }),
    );

    const controller = new AbortController();
    const pending = loadSermonStream(SERMON_ID, client, controller.signal).catch(
      (e: unknown) => e,
    );

    controller.abort();
    const err = await pending;
    expect((err as Error).name).toBe("AbortError");
  });
});

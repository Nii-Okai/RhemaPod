import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";

import { server } from "../msw/server";
import { createApiClient } from "@/lib/api/client";
import {
  loadSermonStream,
  resolvePlaybackSource,
} from "@/lib/query/hooks/use-sermon-stream";

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

/* W1.8 — `resolvePlaybackSource` is the sole discriminator between a
   Cloudflare Stream signed URL and the legacy presigned-S3 fallback
   (`app/services/media_service.py::_resolve_variant_url`). Stream URLs are
   always an HLS manifest at `.../manifest/video.m3u8`
   (`app/core/stream.py::signed_playback_url`, both providers); the S3 path
   never produces that extension. */
describe("resolvePlaybackSource", () => {
  it("returns null for no variant", () => {
    expect(resolvePlaybackSource(null)).toBeNull();
  });

  it("classifies a Cloudflare Stream signed URL as HLS", () => {
    const source = resolvePlaybackSource({
      quality: "720p",
      type: "video",
      url: "https://videodelivery.example/abc123.token/manifest/video.m3u8",
    });
    expect(source).toEqual({
      type: "video",
      url: "https://videodelivery.example/abc123.token/manifest/video.m3u8",
      kind: "hls",
    });
  });

  it("classifies an .m3u8 URL as HLS even with a query string", () => {
    const source = resolvePlaybackSource({
      quality: null,
      type: "video",
      url: "https://cdn.test/x/manifest/video.m3u8?expires=123&sig=abc",
    });
    expect(source?.kind).toBe("hls");
  });

  it("classifies the legacy presigned-S3 progressive URL as progressive", () => {
    const source = resolvePlaybackSource({
      quality: "720p",
      type: "video",
      url: "https://cdn.test/a1.mp4?X-Amz-Signature=abc",
    });
    expect(source?.kind).toBe("progressive");
  });

  it("classifies audio (never Stream-ingested today, W1.6) as progressive", () => {
    const source = resolvePlaybackSource({
      quality: null,
      type: "audio",
      url: "https://cdn.test/a1.m4a",
    });
    expect(source).toEqual({
      type: "audio",
      url: "https://cdn.test/a1.m4a",
      kind: "progressive",
    });
  });
});

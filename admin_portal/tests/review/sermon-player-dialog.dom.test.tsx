import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SermonPlayerDialog } from "@/components/review/sermon-player-dialog";

/* W1.8 — the reviewer preview player, wired for HLS.
 *
 * `_resolve_variant_url` (app/services/media_service.py) hands back one of
 * two URL shapes: a Cloudflare Stream signed playback URL, always an HLS
 * manifest at `.../manifest/video.m3u8` (`app/core/stream.py`), or a
 * presigned-S3 progressive URL (legacy, pre-Stream). A bare `<video src>`
 * can't play the former outside Safari — these tests prove the player picks
 * the right mechanism for each case, without a real Cloudflare account:
 *
 *  - a real MediaSource/hls.js can't run in happy-dom, so `hls.js` is
 *    mocked and we assert on the wiring (`loadSource`/`attachMedia`) rather
 *    than actual segment playback — proving the *mechanism*, not the codec.
 *  - `HTMLMediaElement.prototype.canPlayType` doesn't exist in happy-dom at
 *    all, so it's stubbed per test to simulate Safari's native HLS support
 *    vs. every other browser.
 */

const hlsMocks = vi.hoisted(() => ({
  on: vi.fn(),
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  isSupported: vi.fn(() => true),
}));

vi.mock("hls.js", () => {
  class MockHls {
    static Events = { ERROR: "hlsError" };
    static isSupported = hlsMocks.isSupported;
    on = hlsMocks.on;
    loadSource = hlsMocks.loadSource;
    attachMedia = hlsMocks.attachMedia;
    destroy = hlsMocks.destroy;
  }
  return { default: MockHls };
});

const SERMON_ID = "11111111-1111-1111-1111-111111111111";
const HLS_URL =
  "https://videodelivery.example/signed-token/manifest/video.m3u8";
const PROGRESSIVE_URL = "https://cdn.test/a1.mp4";

function stream(url: string, type: "video" | "audio" = "video") {
  return http.get(`*/api/bff/sermons/${SERMON_ID}/stream`, () =>
    HttpResponse.json({
      sermon_id: SERMON_ID,
      expires_in: 3600,
      variants: [{ quality: "720p", type, url }],
    }),
  );
}

/** Simulates `canPlayType`'s support for native HLS (Safari/iOS) or its
 * absence (Chrome/Firefox/Edge — and happy-dom by default). */
function stubCanPlayType(supportsHls: boolean) {
  HTMLMediaElement.prototype.canPlayType = vi.fn((type: string) =>
    supportsHls && type === "application/vnd.apple.mpegurl" ? "probably" : "",
  ) as HTMLMediaElement["canPlayType"];
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SermonPlayerDialog
        sermonId={SERMON_ID}
        title="Grace upon grace"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

beforeEach(() => {
  hlsMocks.isSupported.mockReturnValue(true);
  stubCanPlayType(false);
});

describe("SermonPlayerDialog — HLS playback (W1.8)", () => {
  it("drives a Stream HLS manifest through hls.js when the browser lacks native HLS support", async () => {
    server.use(stream(HLS_URL));
    renderDialog();

    const player = await screen.findByTestId("sermon-player");
    expect(player.tagName).toBe("VIDEO");

    await waitFor(() => expect(hlsMocks.loadSource).toHaveBeenCalledWith(HLS_URL));
    expect(hlsMocks.attachMedia).toHaveBeenCalledWith(player);
    // hls.js owns playback via MSE, not the `src` attribute.
    expect(player).not.toHaveAttribute("src");
  });

  it("plays a Stream HLS manifest with a plain `src` on a browser with native HLS support (Safari)", async () => {
    stubCanPlayType(true);
    server.use(stream(HLS_URL));
    renderDialog();

    const player = await screen.findByTestId("sermon-player");
    await waitFor(() => expect(player).toHaveAttribute("src", HLS_URL));
    expect(hlsMocks.loadSource).not.toHaveBeenCalled();
    expect(hlsMocks.attachMedia).not.toHaveBeenCalled();
  });

  it("plays the legacy presigned-S3 progressive URL directly, without hls.js", async () => {
    server.use(stream(PROGRESSIVE_URL));
    renderDialog();

    const player = await screen.findByTestId("sermon-player");
    await waitFor(() =>
      expect(player).toHaveAttribute("src", PROGRESSIVE_URL),
    );
    expect(hlsMocks.loadSource).not.toHaveBeenCalled();
    expect(hlsMocks.attachMedia).not.toHaveBeenCalled();
  });

  it("shows a playback error when hls.js reports a fatal error", async () => {
    server.use(stream(HLS_URL));
    renderDialog();

    await screen.findByTestId("sermon-player");
    await waitFor(() => expect(hlsMocks.on).toHaveBeenCalled());

    const [, errorHandler] = hlsMocks.on.mock.calls.find(
      ([event]) => event === "hlsError",
    ) as [string, (event: unknown, data: { fatal: boolean }) => void];

    errorHandler(undefined, { fatal: true });

    expect(
      await screen.findByText("Playback failed. Try again in a moment."),
    ).toBeInTheDocument();
    expect(hlsMocks.destroy).toHaveBeenCalled();
    expect(screen.queryByTestId("sermon-player")).not.toBeInTheDocument();
  });

  it("shows an unsupported-browser message when neither native HLS nor hls.js is available", async () => {
    hlsMocks.isSupported.mockReturnValue(false);
    server.use(stream(HLS_URL));
    renderDialog();

    expect(
      await screen.findByText(
        "This browser can't play this media. Try Chrome, Firefox, Edge, or Safari.",
      ),
    ).toBeInTheDocument();
    expect(hlsMocks.loadSource).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sermon-player")).not.toBeInTheDocument();
  });
});

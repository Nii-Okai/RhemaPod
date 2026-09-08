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
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { ThumbnailCard } from "@/components/sermons/editor/thumbnail-card";

/* W9 item 4 — "Replace image": ticket → XHR PUT → confirm against the thumbnail
   endpoints. BFF calls are MSW; the PUT is a fake XHR (same as media-card). */

const SERMON_ID = "22222222-2222-2222-2222-222222222222";
const STORAGE_URL = "http://storage.test/thumb/put";

class FakeXHR {
  static instances: FakeXHR[] = [];
  static get last() {
    return FakeXHR.instances[FakeXHR.instances.length - 1];
  }
  upload = { onprogress: null as null | (() => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  status = 0;
  responseText = "";
  url = "";
  open(_m: string, u: string) {
    this.url = u;
  }
  setRequestHeader() {}
  send() {
    FakeXHR.instances.push(this);
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  FakeXHR.instances = [];
  vi.unstubAllGlobals();
});
afterAll(() => server.close());
beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXHR));

function backend() {
  const state = { ticketCalls: 0, confirmKey: "" };
  server.use(
    http.post(`*/api/bff/sermons/${SERMON_ID}/thumbnail-url`, () => {
      state.ticketCalls += 1;
      return HttpResponse.json(
        {
          upload_url: STORAGE_URL,
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          expires_in: 3600,
          thumbnail_key: `thumbnails/sermons/${SERMON_ID}/abc.png`,
        },
        { status: 201 },
      );
    }),
    http.post(
      `*/api/bff/sermons/${SERMON_ID}/thumbnail/confirm`,
      ({ request }) => {
        state.confirmKey = new URL(request.url).searchParams.get(
          "thumbnail_key",
        )!;
        return HttpResponse.json({
          thumbnail_url: "http://storage.test/thumb/abc.png",
        });
      },
    ),
  );
  return state;
}

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ThumbnailCard
        sermonId={SERMON_ID}
        thumbnailUrl={null}
        title="The Prodigal Son"
        disabled={false}
      />
    </QueryClientProvider>,
  );
  return {
    ...utils,
    input: () =>
      utils.container.querySelector('input[type="file"]') as HTMLInputElement,
  };
}

function pngFile(name = "cover.png", type = "image/png", size = 4096) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("ThumbnailCard — Replace image", () => {
  it("ticket → PUT → confirm (with the key as a query param) → image swaps in", async () => {
    const state = backend();
    const { input } = renderCard();

    expect(
      screen.queryByAltText("Thumbnail for The Prodigal Son"),
    ).not.toBeInTheDocument();

    await userEvent.upload(input(), pngFile());

    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    expect(FakeXHR.last.url).toBe(STORAGE_URL);
    expect(state.ticketCalls).toBe(1);

    FakeXHR.last.respond(200);

    const img = await screen.findByAltText("Thumbnail for The Prodigal Son");
    expect(img).toHaveAttribute("src", "http://storage.test/thumb/abc.png");
    expect(state.confirmKey).toBe(
      `thumbnails/sermons/${SERMON_ID}/abc.png`,
    );
  });

  it("rejects a non-image before any network call", async () => {
    const state = backend();
    const { input } = renderCard();

    await userEvent.upload(input(), pngFile("notes.txt", "text/plain", 20), {
      applyAccept: false,
    });

    expect(
      await screen.findByText(/isn’t a supported image/),
    ).toBeInTheDocument();
    expect(state.ticketCalls).toBe(0);
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("surfaces a confirm failure with a dismissable alert", async () => {
    backend();
    server.use(
      http.post(`*/api/bff/sermons/${SERMON_ID}/thumbnail/confirm`, () =>
        HttpResponse.json(
          { detail: "No uploaded image found — complete the PUT first" },
          { status: 409 },
        ),
      ),
    );
    const { input } = renderCard();

    await userEvent.upload(input(), pngFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    FakeXHR.last.respond(200);

    expect(
      await screen.findByText(/No uploaded image found/),
    ).toBeInTheDocument();
  });
});

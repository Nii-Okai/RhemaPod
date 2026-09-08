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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";

// The in-browser duration read (`<video>`/`<audio>` loadedmetadata) never
// resolves under happy-dom; it isn't what these tests exercise, so stub it to
// "no duration" — confirm is then called with an empty body, exactly as it is
// for a file whose metadata can't be read.
vi.mock("@/lib/upload/duration", () => ({
  readMediaDuration: () => Promise.resolve(null),
}));

import { MediaJobsCard } from "@/components/sermons/editor/media-jobs-card";
import { UploadProvider } from "@/lib/upload";
import { MAX_UPLOAD_BYTES } from "@/lib/upload/constants";
import type { UploadJobPublic } from "@/lib/upload/api";

/* W9 — the upload pipeline, rendered (happy-dom). Every BFF call is MSW; the
   direct-to-storage PUT is a hand fake of XMLHttpRequest (plan §A.5 / §A.11).

   Covered: pre-flight rejects (.txt / oversize) with NO network; the happy
   path (ticket → XHR 200 → confirm → processing → ready via a poll tick);
   PUT 403 → Failed + Retry; Retry issues a NEW ticket (not a 2nd confirm); a
   job polling to `failed` shows its error_message; confirm 413 → size message. */

const SERMON_ID = "11111111-1111-1111-1111-111111111111";
const STORAGE_URL = "http://storage.test/put/object";

/* --- fake XMLHttpRequest --------------------------------------------------- */

interface Progressish {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

class FakeXHR {
  static instances: FakeXHR[] = [];
  static reset() {
    FakeXHR.instances = [];
  }
  static get last(): FakeXHR | undefined {
    return FakeXHR.instances[FakeXHR.instances.length - 1];
  }

  upload = { onprogress: null as ((e: Progressish) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 0;
  timeout = 0;
  responseText = "";
  method = "";
  url = "";
  aborted = false;
  headers: Record<string, string> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {
    FakeXHR.instances.push(this);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  /** A completed response (any status). XHR fires `onload` even for a 4xx. */
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
  /** A transport-level failure (network / CORS): status 0, `onerror`. */
  networkError() {
    this.status = 0;
    this.onerror?.();
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  FakeXHR.reset();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());
beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

/* --- backend doubles ----------------------------------------------------- */

function job(over: Partial<UploadJobPublic> = {}): UploadJobPublic {
  return {
    id: "job-1",
    sermon_id: SERMON_ID,
    media_type: "video",
    status: "processing",
    original_filename: "sermon.mp4",
    content_type: "video/mp4",
    size_bytes: 2_200_000_000,
    error_message: null,
    created_at: "2026-09-08T10:00:00Z",
    ...over,
  };
}

interface BackendState {
  ticketCalls: number;
  confirmCalls: number;
  uploads: UploadJobPublic[];
  confirmStatus: number;
  confirmBody: unknown;
}

function backend(initial: Partial<BackendState> = {}) {
  const state: BackendState = {
    ticketCalls: 0,
    confirmCalls: 0,
    uploads: [],
    confirmStatus: 200,
    confirmBody: job({ status: "processing" }),
    ...initial,
  };

  server.use(
    http.post(`*/api/bff/sermons/${SERMON_ID}/upload-url`, () => {
      state.ticketCalls += 1;
      return HttpResponse.json(
        {
          job_id: `job-${state.ticketCalls}`,
          upload_url: STORAGE_URL,
          method: "PUT",
          headers: { "Content-Type": "video/mp4" },
          expires_in: 3600,
          raw_key: "raw/sermon.mp4",
        },
        { status: 201 },
      );
    }),
    http.post("*/api/bff/uploads/:jobId/confirm", () => {
      state.confirmCalls += 1;
      return HttpResponse.json(state.confirmBody as object, {
        status: state.confirmStatus,
      });
    }),
    http.get(`*/api/bff/sermons/${SERMON_ID}/uploads`, () =>
      HttpResponse.json(state.uploads),
    ),
    http.get(`*/api/bff/sermons/${SERMON_ID}/media`, () =>
      HttpResponse.json([{ id: "m1", type: "video", quality: null, s3_key: "k", hls_manifest_key: null }]),
    ),
  );

  return state;
}

function renderCard(opts: { disabled?: boolean; stallMs?: number } = {}) {
  const { disabled = false, stallMs } = opts;
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <UploadProvider sermonId={SERMON_ID} stallMs={stallMs}>
        <MediaJobsCard
          sermonId={SERMON_ID}
          sermonDurationSeconds={1862}
          disabled={disabled}
        />
      </UploadProvider>
    </QueryClientProvider>,
  );
  const fileInput = () =>
    utils.container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
  return { qc, fileInput, ...utils };
}

function mediaFile(name = "sermon.mp4", type = "video/mp4", size = 2_200_000_000) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

/* --- pre-flight --------------------------------------------------------- */

describe("Media card — pre-flight validation", () => {
  it("rejects a .txt with no network call", async () => {
    const state = backend();
    const { fileInput } = renderCard();

    // `applyAccept: false` so our own `validateMediaFile` is what rejects it,
    // not the <input accept> filter (the design's drop target has no such gate).
    await userEvent.upload(
      fileInput(),
      mediaFile("notes.txt", "text/plain", 20),
      { applyAccept: false },
    );

    expect(await screen.findByText(/isn’t a supported file/)).toBeInTheDocument();
    expect(state.ticketCalls).toBe(0);
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("rejects an oversized file with no network call", async () => {
    const state = backend();
    const { fileInput } = renderCard();

    await userEvent.upload(
      fileInput(),
      mediaFile("huge.mp4", "video/mp4", MAX_UPLOAD_BYTES + 1),
    );

    expect(await screen.findByText(/larger than the 5 GB limit/)).toBeInTheDocument();
    expect(state.ticketCalls).toBe(0);
    expect(FakeXHR.instances).toHaveLength(0);
  });
});

/* --- happy path -------------------------------------------------------- */

describe("Media card — happy path", () => {
  it("ticket → XHR PUT 200 → confirm → processing, then ready as the poll advances", async () => {
    const state = backend();
    const { qc, fileInput } = renderCard();

    await userEvent.upload(fileInput(), mediaFile());

    // Ticket issued, PUT started.
    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    expect(state.ticketCalls).toBe(1);
    expect(FakeXHR.last!.method).toBe("PUT");
    expect(FakeXHR.last!.url).toBe(STORAGE_URL);
    expect(FakeXHR.last!.headers["Content-Type"]).toBe("video/mp4");

    // Progress → the mono "64% · <sent> / <total>" line (binary units via
    // `formatBytes`).
    FakeXHR.last!.emitProgress(1_400_000_000, 2_200_000_000);
    expect(
      await screen.findByText("64% · 1.3 GB / 2 GB"),
    ).toBeInTheDocument();

    // PUT completes → confirm fires → server says "processing".
    state.uploads = [job({ id: "job-1", status: "processing" })];
    FakeXHR.last!.respond(200);

    await waitFor(() => expect(state.confirmCalls).toBe(1));
    expect(await screen.findByText("Processing")).toBeInTheDocument();

    // The 3s poll tick (stood in for by an explicit refetch): job → ready.
    state.uploads = [job({ id: "job-1", status: "ready" })];
    await qc.invalidateQueries();

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(
      await screen.findByText("video · 31:02 · 1 rendition ready"),
    ).toBeInTheDocument();
  });
});

/* --- transfer failure + retry --------------------------------------- */

describe("Media card — PUT failure and retry", () => {
  it("a 403 on the PUT surfaces an expired-link message and offers Retry", async () => {
    backend();
    const { fileInput } = renderCard();

    await userEvent.upload(fileInput(), mediaFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());

    FakeXHR.last!.respond(403);

    expect(
      await screen.findByText(/upload link expired before the file finished/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Retry upload" }),
    ).toBeInTheDocument();
  });

  it("Retry requests a brand-new ticket, never a second confirm", async () => {
    const state = backend();
    const { fileInput } = renderCard();

    await userEvent.upload(fileInput(), mediaFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    FakeXHR.last!.respond(403);

    await screen.findByRole("button", { name: "Retry upload" });
    expect(state.ticketCalls).toBe(1);
    expect(state.confirmCalls).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "Retry upload" }));

    // A 2nd ticket, a 2nd PUT — and still zero confirms (the object may not be
    // there; a re-confirm would 409). Plan §A.5.
    await waitFor(() => expect(state.ticketCalls).toBe(2));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    expect(state.confirmCalls).toBe(0);
  });

  it("a mid-PUT network drop (status 0 / onerror) → Failed row + a working Retry", async () => {
    const state = backend();
    const { fileInput } = renderCard();

    await userEvent.upload(fileInput(), mediaFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    expect(state.ticketCalls).toBe(1);

    // The connection dies mid-transfer: XHR fires `onerror` with status 0.
    FakeXHR.last!.networkError();

    expect(
      await screen.findByText(/connection dropped or was blocked/),
    ).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: "Retry upload" });
    expect(state.confirmCalls).toBe(0);

    // Retry mints a fresh ticket + PUT, still zero confirms.
    await userEvent.click(retry);
    await waitFor(() => expect(state.ticketCalls).toBe(2));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    expect(state.confirmCalls).toBe(0);
  });
});

/* --- credential / URL invariants (security-reviewer N2) ------------ */

describe("Media card — the direct PUT carries no credentials", () => {
  it("sets only Content-Type, never Authorization / withCredentials, and never renders the presigned URL", async () => {
    const state = backend();
    const { fileInput } = renderCard();

    await userEvent.upload(fileInput(), mediaFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());

    const xhr = FakeXHR.last!;
    expect(Object.keys(xhr.headers)).toEqual(["Content-Type"]);
    expect(xhr.headers.Authorization).toBeUndefined();
    // `withCredentials` is never touched → no cookies on the cross-origin PUT.
    expect(
      (xhr as unknown as { withCredentials?: boolean }).withCredentials,
    ).toBeUndefined();

    // Drive it to a failure and confirm the presigned URL is in neither the
    // DOM nor the surfaced error copy.
    xhr.respond(403);
    await screen.findByText(/upload link expired/);
    expect(document.body.textContent ?? "").not.toContain(STORAGE_URL);
    expect(state.confirmCalls).toBe(0);
  });
});

/* --- stall watchdog ------------------------------------------------- */

describe("Media card — a stalled PUT (half-open socket)", () => {
  it("the stall watchdog marks the row Failed + retryable when no progress lands", async () => {
    // `stallMs: 40` so the watchdog fires within the default findBy timeout;
    // no progress and no `respond()` — the socket is wedged half-open.
    const state = backend();
    const { fileInput } = renderCard({ stallMs: 40 });

    await userEvent.upload(fileInput(), mediaFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());

    expect(await screen.findByText(/stalled/)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Retry upload" }),
    ).toBeInTheDocument();
    expect(state.confirmCalls).toBe(0);
    // The wedged XHR was torn down.
    await waitFor(() => expect(FakeXHR.last!.aborted).toBe(true));
  });
});

/* --- polled-to-failed ------------------------------------------------ */

describe("Media card — job polls to failed", () => {
  it("renders the raw error_message and a Retry", async () => {
    backend({
      uploads: [
        job({
          id: "job-x",
          status: "failed",
          error_message: "transcode worker: ffmpeg exited 1",
        }),
      ],
    });
    renderCard();

    expect(
      await screen.findByText("transcode worker: ffmpeg exited 1"),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry upload" }),
    ).toBeInTheDocument();
  });
});

/* --- confirm 413 --------------------------------------------------- */

describe("Media card — confirm rejects oversized (413)", () => {
  it("renders the size-limit message and a Retry", async () => {
    const state = backend({
      confirmStatus: 413,
      confirmBody: {
        detail: "File exceeds the maximum upload size of 5 GB",
        correlation_id: "cid-413",
      },
    });
    const { fileInput } = renderCard();

    await userEvent.upload(fileInput(), mediaFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    FakeXHR.last!.respond(200);

    await waitFor(() => expect(state.confirmCalls).toBe(1));
    const row = await screen.findByText("File is larger than the 5 GB limit.");
    expect(row).toBeInTheDocument();
    expect(
      within(row.closest('[data-slot="upload-job"]') as HTMLElement).getByRole(
        "button",
        { name: "Retry upload" },
      ),
    ).toBeInTheDocument();
  });
});

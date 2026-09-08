import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UploadAbortedError, UploadPutError } from "@/lib/upload/errors";
import { putFileWithProgress } from "@/lib/upload/xhr-put";

/* W9 fix pass — gilfoyle 🔴 #1: the PUT had a dead `ontimeout` and no stall
   detection, so a half-open socket hung the row forever. These pin the stall
   watchdog with fake timers: it fires on no-progress, it resets on every
   progress tick, and it is cleared the moment the request settles. */

interface Progressish {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

class FakeXHR {
  static last: FakeXHR | undefined;

  upload = { onprogress: null as ((e: Progressish) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 0;
  timeout = 0;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sent = false;
  aborted = false;

  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {
    this.sent = true;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  complete(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const BLOB = new Blob(["x".repeat(64)], { type: "video/mp4" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  FakeXHR.last = undefined;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("putFileWithProgress — stall watchdog", () => {
  it("sets a hard xhr.timeout ceiling of 4× the stall window", () => {
    void putFileWithProgress("http://s/put", BLOB, {
      contentType: "video/mp4",
      stallMs: 1000,
    }).catch(() => {});
    expect(FakeXHR.last!.timeout).toBe(4000);
  });

  it("rejects UploadPutError(0,'timeout') and aborts the xhr after stallMs of no progress", async () => {
    const p = putFileWithProgress("http://s/put", BLOB, {
      contentType: "video/mp4",
      stallMs: 1000,
    });
    const caught = p.catch((e) => e as Error);

    await vi.advanceTimersByTimeAsync(999);
    // still pending — one tick short
    let done = false;
    void caught.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(UploadPutError);
    expect((err as UploadPutError).status).toBe(0);
    expect((err as UploadPutError).reason).toBe("timeout");
    expect(FakeXHR.last!.aborted).toBe(true);
  });

  it("resets the watchdog on every progress tick", async () => {
    const p = putFileWithProgress("http://s/put", BLOB, {
      contentType: "video/mp4",
      stallMs: 1000,
      onProgress: () => {},
    });
    const caught = p.catch((e) => e as Error);

    // Three near-misses: progress each time keeps the transfer alive.
    for (let i = 1; i <= 3; i++) {
      await vi.advanceTimersByTimeAsync(800);
      FakeXHR.last!.progress(i * 16, 64);
    }
    let settled = false;
    void caught.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    // Now stop feeding it.
    await vi.advanceTimersByTimeAsync(1000);
    const err = await caught;
    expect((err as UploadPutError).reason).toBe("timeout");
  });

  it("clears the watchdog on a successful settle — no late rejection", async () => {
    const p = putFileWithProgress("http://s/put", BLOB, {
      contentType: "video/mp4",
      stallMs: 1000,
    });
    const outcome = p.then(
      () => "resolved",
      () => "rejected",
    );

    FakeXHR.last!.complete(200);
    await vi.advanceTimersByTimeAsync(10_000); // long past the window

    expect(await outcome).toBe("resolved");
  });

  it("clears the watchdog when the caller aborts via signal", async () => {
    const controller = new AbortController();
    const p = putFileWithProgress("http://s/put", BLOB, {
      contentType: "video/mp4",
      stallMs: 1000,
      signal: controller.signal,
    });
    const caught = p.catch((e) => e as Error);

    controller.abort();
    const err = await caught;
    expect(err).toBeInstanceOf(UploadAbortedError);

    // Watchdog is gone — advancing time produces nothing further.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeXHR.last!.aborted).toBe(true);
  });

  it("maps the native ontimeout to the same retryable timeout error", async () => {
    const p = putFileWithProgress("http://s/put", BLOB, {
      contentType: "video/mp4",
      stallMs: 1000,
    });
    const caught = p.catch((e) => e as Error);

    FakeXHR.last!.ontimeout?.();
    const err = await caught;
    expect(err).toBeInstanceOf(UploadPutError);
    expect((err as UploadPutError).reason).toBe("timeout");
  });
});

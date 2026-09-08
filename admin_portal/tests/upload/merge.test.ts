import { describe, expect, it } from "vitest";

import type { UploadJobPublic } from "@/lib/upload/api";
import { mergeUploadRows } from "@/lib/upload/merge";
import type { LocalUpload } from "@/lib/upload/types";

/* W9 — the optimistic-vs-server row merge / dedupe by job_id (plan §A.5 State
   mapping + §A.4 "defer to server state once the job appears"). Pure. */

function local(over: Partial<LocalUpload> = {}): LocalUpload {
  return {
    clientId: "c1",
    jobId: null,
    retryOfJobId: null,
    filename: "sermon.mp4",
    sizeBytes: 2_200_000_000,
    mediaType: "video",
    contentType: "video/mp4",
    phase: "uploading",
    bytesSent: 1_400_000_000,
    etaSeconds: 180,
    error: null,
    ...over,
  };
}

function job(over: Partial<UploadJobPublic> = {}): UploadJobPublic {
  return {
    id: "j1",
    sermon_id: "s1",
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

describe("mergeUploadRows", () => {
  it("renders an in-flight local upload as a single 'uploading' row with pct + eta", () => {
    const rows = mergeUploadRows([local()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("uploading");
    expect(rows[0].pct).toBe(64); // 1.4 / 2.2 GB
    expect(rows[0].progressLabel).toContain("64%");
    expect(rows[0].etaLabel).toBe("Uploading — about 3 min remaining");
    expect(rows[0].badgeStatus).toBeNull();
  });

  it("passes server jobs through when there is no local twin", () => {
    const rows = mergeUploadRows([], [job({ status: "processing" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("processing");
    expect(rows[0].key).toBe("j1");
  });

  it("defers to the server row once the local upload's job appears (dedupe by job_id)", () => {
    const rows = mergeUploadRows(
      [local({ jobId: "j1", phase: "processing" })],
      [job({ id: "j1", status: "processing" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("j1"); // server row, not the local clientId
  });

  it("keeps the LOCAL error row and suppresses its server stub twin", () => {
    const rows = mergeUploadRows(
      [
        local({
          jobId: "j1",
          phase: "error",
          error: { surface: "transfer", message: "The upload link expired." },
        }),
      ],
      [job({ id: "j1", status: "awaiting_upload", error_message: null })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("failed");
    expect(rows[0].errorMessage).toBe("The upload link expired.");
    expect(rows[0].retry).toEqual({ kind: "local", clientId: "c1" });
  });

  it("suppresses the superseded job when a Retry is in flight", () => {
    const rows = mergeUploadRows(
      [local({ clientId: "c2", jobId: null, retryOfJobId: "j1", phase: "uploading" })],
      [job({ id: "j1", status: "failed", error_message: "boom" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("uploading");
  });

  it("renders a polled 'failed' job with its verbatim error_message + a server Retry", () => {
    const rows = mergeUploadRows(
      [],
      [job({ id: "j9", status: "failed", error_message: "ffmpeg: exit 1" })],
    );
    expect(rows[0].state).toBe("failed");
    expect(rows[0].errorMessage).toBe("ffmpeg: exit 1");
    expect(rows[0].retry).toEqual({
      kind: "server",
      jobId: "j9",
      filename: "sermon.mp4",
    });
  });

  it("builds the 'ready' sub-line from sermon duration + rendition count", () => {
    const rows = mergeUploadRows([], [job({ status: "ready" })], {
      durationSeconds: 1862,
      renditionCount: 2,
    });
    expect(rows[0].state).toBe("ready");
    expect(rows[0].subLine).toBe("video · 31:02 · 2 renditions ready");
  });

  it("omits the duration segment when the sermon has none", () => {
    const rows = mergeUploadRows([], [job({ status: "ready" })], {
      durationSeconds: null,
      renditionCount: 1,
    });
    expect(rows[0].subLine).toBe("video · 1 rendition ready");
  });

  it("orders in-flight local rows before the server list", () => {
    const rows = mergeUploadRows(
      [local({ clientId: "cNew", phase: "uploading" })],
      [job({ id: "jOld", status: "ready" })],
    );
    expect(rows.map((r) => r.key)).toEqual(["cNew", "jOld"]);
  });

  it("renders an orphaned awaiting_upload job as a non-alarming 'stalled' row", () => {
    const rows = mergeUploadRows([], [job({ id: "jA", status: "awaiting_upload" })]);
    expect(rows[0].state).toBe("stalled");
    expect(rows[0].retry).toEqual({
      kind: "server",
      jobId: "jA",
      filename: "sermon.mp4",
    });
  });
});

import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  ConfirmError,
  ProcessingError,
  TicketError,
  UploadAbortedError,
  UploadPutError,
  UploadValidationError,
  describeUploadFailure,
} from "@/lib/upload/errors";

/* W9 fix pass — the failure-surface mapper. gilfoyle 🔴 #2: the 6-surface
   mapping was directly untested. Every branch, plus the fallthroughs. */

describe("describeUploadFailure — every surface", () => {
  it("validation → surface 'validation', message verbatim, NOT retryable", () => {
    const out = describeUploadFailure(
      new UploadValidationError(
        "'notes.txt' isn't a supported file. Upload an MP4, MOV, MP3, or M4A.",
      ),
    );
    expect(out.surface).toBe("validation");
    expect(out.message).toContain("isn't a supported file");
    expect(out.retryable).toBe(false);
  });

  it("ticket (wrapped ApiError) → surface 'ticket', retryable", () => {
    const out = describeUploadFailure(
      new TicketError("Couldn’t start the upload: sermon is locked"),
    );
    expect(out.surface).toBe("ticket");
    expect(out.message).toContain("sermon is locked");
    expect(out.retryable).toBe(true);
  });

  it("transfer status 0 (connection dropped) → distinct 'connection dropped' copy", () => {
    const out = describeUploadFailure(new UploadPutError(0));
    expect(out.surface).toBe("transfer");
    expect(out.message).toMatch(/connection dropped or was blocked/);
    expect(out.retryable).toBe(true);
  });

  it("transfer status 0 + reason 'timeout' (stall) → 'stalled' copy, NOT 'connection dropped'", () => {
    const out = describeUploadFailure(new UploadPutError(0, "timeout"));
    expect(out.surface).toBe("transfer");
    expect(out.message).toMatch(/stalled/);
    expect(out.message).not.toMatch(/connection dropped/);
    expect(out.retryable).toBe(true);
  });

  it("transfer abort → NOT 'connection dropped', retryable", () => {
    const out = describeUploadFailure(new UploadAbortedError());
    expect(out.surface).toBe("transfer");
    expect(out.message).not.toMatch(/connection dropped/);
    expect(out.message).toMatch(/stopped/);
    expect(out.retryable).toBe(true);
  });

  it("transfer 403 → 'link expired' copy, retryable", () => {
    const out = describeUploadFailure(new UploadPutError(403));
    expect(out.surface).toBe("transfer");
    expect(out.message).toMatch(/link expired/);
    expect(out.retryable).toBe(true);
  });

  it("transfer other non-2xx → generic HTTP copy carrying the status, retryable", () => {
    const out = describeUploadFailure(new UploadPutError(500));
    expect(out.surface).toBe("transfer");
    expect(out.message).toMatch(/HTTP 500/);
    expect(out.retryable).toBe(true);
  });

  it("confirm 413 → canned size-limit copy (not the server detail), retryable", () => {
    const out = describeUploadFailure(
      new ConfirmError(413, "File exceeds the maximum upload size of 5 GB"),
    );
    expect(out.surface).toBe("confirm");
    expect(out.message).toBe("File is larger than the 5 GB limit.");
    expect(out.retryable).toBe(true);
  });

  it("confirm other status → server detail verbatim, retryable", () => {
    const out = describeUploadFailure(
      new ConfirmError(409, "No uploaded object found — complete the PUT first"),
    );
    expect(out.surface).toBe("confirm");
    expect(out.message).toBe(
      "No uploaded object found — complete the PUT first",
    );
    expect(out.retryable).toBe(true);
  });

  it("processing (job error_message) → surface 'processing', message verbatim, retryable", () => {
    const out = describeUploadFailure(
      new ProcessingError("transcode worker: ffmpeg exited 1"),
    );
    expect(out.surface).toBe("processing");
    expect(out.message).toBe("transcode worker: ffmpeg exited 1");
    expect(out.retryable).toBe(true);
  });

  it("a bare ApiError (not wrapped) falls through to 'ticket' with detail + correlation id", () => {
    const out = describeUploadFailure(
      new ApiError(502, { detail: "upstream is down", correlation_id: "cid-77" }),
    );
    expect(out.surface).toBe("ticket");
    expect(out.message).toContain("upstream is down");
    expect(out.message).toContain("cid-77");
    expect(out.retryable).toBe(true);
  });

  it("a non-Error throw → generic transfer copy, no leak of the raw value, retryable", () => {
    for (const raw of ["kaboom", undefined, 42, { secret: "s3://bucket/key" }]) {
      const out = describeUploadFailure(raw);
      expect(out.surface).toBe("transfer");
      expect(out.message).toBe(
        "Something went wrong with the upload. Retry to start over.",
      );
      expect(out.message).not.toMatch(/kaboom|s3:\/\/|bucket/);
      expect(out.retryable).toBe(true);
    }
  });

  it("only 'validation' is non-retryable across the whole surface", () => {
    const cases: unknown[] = [
      new TicketError("x"),
      new UploadPutError(0),
      new UploadPutError(0, "timeout"),
      new UploadPutError(403),
      new UploadPutError(500),
      new UploadAbortedError(),
      new ConfirmError(413, "x"),
      new ConfirmError(409, "x"),
      new ProcessingError("x"),
      new ApiError(500, { detail: "x" }),
      "raw",
    ];
    for (const c of cases) expect(describeUploadFailure(c).retryable).toBe(true);
    expect(
      describeUploadFailure(new UploadValidationError("x")).retryable,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  hasActiveUploadJob,
  type UploadJob,
} from "@/lib/query/hooks/use-sermon-uploads";

/* The 3s upload poll is armed **only while** a job is non-terminal
   (`awaiting_upload` / `uploaded` / `processing`) and off otherwise — wired in
   W8 so W9 only adds the upload action, not the refresh loop (plan §A.4). */

const job = (status: UploadJob["status"]): UploadJob => ({
  id: crypto.randomUUID(),
  sermon_id: "s-1",
  media_type: "video",
  status,
  original_filename: "clip.mp4",
  content_type: "video/mp4",
  size_bytes: 1024,
  error_message: null,
  created_at: "2026-09-08T10:00:00Z",
});

describe("hasActiveUploadJob", () => {
  it("is false for an empty / undefined list", () => {
    expect(hasActiveUploadJob(undefined)).toBe(false);
    expect(hasActiveUploadJob([])).toBe(false);
  });

  it("is false when every job is terminal (ready / failed)", () => {
    expect(hasActiveUploadJob([job("ready"), job("failed")])).toBe(false);
  });

  it.each(["awaiting_upload", "uploaded", "processing"] as const)(
    "is true when any job is %s",
    (status) => {
      expect(hasActiveUploadJob([job("ready"), job(status)])).toBe(true);
    },
  );
});

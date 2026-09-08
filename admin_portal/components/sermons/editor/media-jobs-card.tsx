"use client";

import { cn } from "cn";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/portal/status-badge";
import { formatBytes } from "@/lib/format";
import type { UploadJob } from "@/lib/query/hooks/use-sermon-uploads";

/* =============================================================================
   Media card (design Screen 4, left column, bottom).

   W8 SCOPE = READ-ONLY. The dropzone is present but disabled ("Uploading
   arrives next"); the XHR uploader, presigned PUT, duration extraction, retry
   and the live progress line are W9 (plan §A.5). This card lists the existing
   `UploadJob` rows and nothing more.

   Row states (design):
     awaiting_upload / uploaded / processing → slate "Processing" family
     ready   → sage
     failed  → row bg #FCF8F8, rose badge, the raw `error_message` in mono
               rose, a DISABLED "Retry upload" (title → W9). Failed rows are
               never auto-cleared.
   ========================================================================== */

const ACCEPT_HINT = "MP4, MOV, MP3, M4A · up to 5 GB";

function subLine(job: UploadJob): string {
  switch (job.status) {
    case "ready":
      return `${job.media_type} · ready`;
    case "processing":
    case "uploaded":
      return `${job.media_type} · processing renditions`;
    case "awaiting_upload":
      return `${job.media_type} · waiting for the file`;
    case "failed":
      return "";
  }
}

function UploadRow({ job }: { job: UploadJob }) {
  const failed = job.status === "failed";
  const name = job.original_filename ?? "Uploaded file";
  const size = job.size_bytes != null ? formatBytes(job.size_bytes) : null;

  return (
    <div
      data-slot="upload-job"
      data-status={job.status}
      className={cn(
        "flex flex-col gap-6 border-t border-border-subtle px-2 py-14 first:border-t-0",
        failed && "-mx-2 rounded-8 bg-[#FCF8F8] px-4",
      )}
    >
      <div className="flex items-center justify-between gap-12">
        <span className="truncate text-[13.5px] font-semibold text-ink">
          {name}
        </span>
        <StatusBadge status={job.status} className="shrink-0" />
      </div>

      {failed ? (
        <p className="font-mono text-[12px] leading-[1.5] text-rose">
          {job.error_message ?? "Upload failed."}
        </p>
      ) : (
        <p className="text-[12.5px] text-ink-muted">
          {[subLine(job), size].filter(Boolean).join(" · ")}
        </p>
      )}

      {failed ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled
            title="Retrying uploads arrives in W9"
          >
            Retry upload
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface MediaJobsCardProps {
  jobs: UploadJob[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function MediaJobsCard({ jobs, isLoading, isError }: MediaJobsCardProps) {
  return (
    <Card className="flex flex-col gap-14 p-22">
      <CardHeader>
        <CardTitle>Media</CardTitle>
        <span className="text-mono-meta text-ink-faint">
          pre-signed · direct to S3
        </span>
      </CardHeader>

      {/* Dropzone — present but disabled for W8. */}
      <div
        data-slot="dropzone"
        aria-disabled
        className="flex cursor-not-allowed flex-col items-center gap-6 rounded-12 border border-dashed border-border-strong bg-surface-sunken p-26 text-center opacity-70"
      >
        <span className="text-[14px] font-semibold text-ink-muted">
          Drop video or audio here
        </span>
        <span className="text-[12.5px] text-ink-faint">{ACCEPT_HINT}</span>
        <Button size="sm" variant="secondary" disabled className="mt-4">
          Choose file
        </Button>
        <span className="text-mono-meta text-ink-faint">
          Uploading arrives next (W9)
        </span>
      </div>

      {isError ? (
        <p className="text-[13px] text-ink-faint">
          Couldn’t load the upload jobs. Reload to try again.
        </p>
      ) : isLoading ? (
        <p className="text-[13px] text-ink-faint">Loading media…</p>
      ) : !jobs || jobs.length === 0 ? (
        <p className="text-[13px] text-ink-faint">No media uploaded yet.</p>
      ) : (
        <div className="flex flex-col">
          {jobs.map((job) => (
            <UploadRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </Card>
  );
}

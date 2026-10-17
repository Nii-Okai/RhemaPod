"use client";

import * as React from "react";
import { cn } from "cn";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/portal/status-badge";
import { formatBytes } from "@/lib/format";
import { useSermonMedia } from "@/lib/query/hooks/use-sermon-media";
import { useSermonUploads } from "@/lib/query/hooks/use-sermon-uploads";
import {
  MEDIA_ACCEPT_ATTR,
  mergeUploadRows,
  useUploadContext,
  type UploadRow,
} from "@/lib/upload";

/* =============================================================================
   Media card — design Screen 4 "Sermon editor" → Media card (plan W9).

   The dashed dropzone (drag-drop + Choose file, multiple allowed) requests a
   presigned ticket, PUTs direct to storage over XHR, confirms, then the 3s
   conditional poll (`useSermonUploads`) takes over. Rows merge the optimistic
   in-flight uploads (`UploadProvider`) with the polled `UploadJobPublic[]`,
   deduped by job id (plan §A.5).

   One sermon, one media slot (Isaac, item 6 fix): a plain pick/drop (not a
   Retry) always supersedes every job already on the sermon — `handleFiles`
   passes `serverJobs`'s ids to `upload.enqueue` as `supersedes` — so the new
   upload's row is the only one visible, even when it's a different media
   type than what was there before. Before this fix the old "ready" row and
   the new "uploading" row rendered side by side indefinitely (the backend
   keeps every `UploadJob` a sermon has ever had, and `GET .../uploads`
   returns the full history) — two "media" sections that read as if the
   sermon had both a video and an audio file. The supersede is session-only
   (same limitation Retry already has, per `lib/upload/merge.ts`): a reload
   before the new job lands in the poll will un-hide the old row again. A
   durable fix needs a backend cancel/delete route for the superseded job —
   tracked, not attempted here (frontend scope only).

   Row states:
     Uploading  — filename + mono "64% · 1.4 / 2.2 GB" + 6px clay bar +
                  "Uploading — N min remaining"       (client XHR only)
     Processing — slate badge, gradient bar, renditions sub-line
     Ready       — sage badge, "audio · 31:02 · 2 renditions ready"
     Failed      — row bg #FCF8F8, rose badge, raw error_message in mono rose,
                   Retry upload. Never auto-cleared.
     Stalled     — an awaiting_upload job with no live client row (a reload lost
                   the PUT): honest "didn't finish — retry" row.
   ========================================================================== */

const ACCEPT_HINT = "MP4, MOV, MP3, M4A · up to 5 GB";

export interface MediaJobsCardProps {
  sermonId: string | undefined;
  /** For the "ready" sub-line "audio · 31:02 · …" — the job DTO has no duration. */
  sermonDurationSeconds: number | null;
  /** Locked (in review) or no saved sermon yet — dropzone is inert. */
  disabled: boolean;
}

export function MediaJobsCard({
  sermonId,
  sermonDurationSeconds,
  disabled,
}: MediaJobsCardProps) {
  const upload = useUploadContext();
  const uploadsQuery = useSermonUploads(sermonId);
  const serverJobs = React.useMemo(
    () => uploadsQuery.data ?? [],
    [uploadsQuery.data],
  );

  // A ready row only ever comes from a server job (no local phase reaches
  // "ready"), so this gate needs no merge pass.
  const anyReady = React.useMemo(
    () => serverJobs.some((j) => j.status === "ready"),
    [serverJobs],
  );

  const mediaQuery = useSermonMedia(sermonId, anyReady);
  const renditionCount = mediaQuery.data?.length ?? null;

  const finalRows = React.useMemo(
    () =>
      mergeUploadRows(
        upload.uploads,
        serverJobs,
        { durationSeconds: sermonDurationSeconds, renditionCount },
        upload.supersededJobIds,
      ),
    [
      upload.uploads,
      upload.supersededJobIds,
      serverJobs,
      sermonDurationSeconds,
      renditionCount,
    ],
  );

  // Release the File once the job has landed in the server list.
  const reconcile = upload.reconcile;
  React.useEffect(() => {
    reconcile(serverJobs.map((j) => j.id));
  }, [serverJobs, reconcile]);

  // --- file picking ------------------------------------------------------
  const inputRef = React.useRef<HTMLInputElement>(null);
  // When set, the next picked file supersedes this failed/stalled server job.
  const retryTargetRef = React.useRef<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);

  const openPicker = () => {
    if (disabled) return;
    retryTargetRef.current = null;
    inputRef.current?.click();
  };

  const openPickerForRetry = (jobId: string) => {
    retryTargetRef.current = jobId;
    inputRef.current?.click();
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const retryJob = retryTargetRef.current;
    retryTargetRef.current = null;
    if (retryJob) {
      upload.retryServer(retryJob, list[0]);
    } else {
      // Not a Retry — a plain pick/drop. One sermon, one media slot: this
      // always replaces whatever's already attached, so every job already on
      // the sermon is superseded the moment a new file is accepted (item 6
      // fix — a second upload used to render alongside the first forever).
      upload.enqueue(
        list,
        serverJobs.map((job) => job.id),
      );
    }
  };

  // A drag-drop is always a fresh add, never a retry of a specific job. Clear
  // any target left behind by a Retry click whose OS file dialog was then
  // cancelled (no `change` event fires on cancel) — otherwise the drop is
  // misrouted as a supersede of a stale job id.
  const clearRetryTarget = React.useCallback(() => {
    retryTargetRef.current = null;
  }, []);

  // Belt-and-braces: browsers that fire the input `cancel` event let us clear
  // the stale target the moment the dialog is dismissed. (React has no typed
  // `onCancel` for <input>, hence the native listener.)
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.addEventListener("cancel", clearRetryTarget);
    return () => el.removeEventListener("cancel", clearRetryTarget);
  }, [clearRetryTarget]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    clearRetryTarget();
    handleFiles(e.dataTransfer.files);
  };

  const dropzoneHint = disabled
    ? sermonId
      ? "Media can’t be changed while the sermon is in review."
      : "Save the draft before adding media."
    : ACCEPT_HINT;

  return (
    <Card className="flex flex-col gap-14 p-22">
      <CardHeader>
        <CardTitle>Media</CardTitle>
      </CardHeader>

      <input
        ref={inputRef}
        type="file"
        accept={MEDIA_ACCEPT_ATTR}
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        data-slot="dropzone"
        aria-disabled={disabled}
        onDragOver={(e) => {
          e.preventDefault();
          if (disabled) return;
          clearRetryTarget();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-6 rounded-12 border border-dashed border-border-strong bg-surface-sunken p-26 text-center transition-colors",
          disabled && "cursor-not-allowed opacity-70",
          dragActive && "border-clay-600 bg-clay-50",
        )}
      >
        <span className="text-[14px] font-semibold text-ink-muted">
          Drop video or audio here
        </span>
        <span className="text-[12.5px] text-ink-faint">{dropzoneHint}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={openPicker}
          className="mt-4"
        >
          Choose file
        </Button>
      </div>

      {upload.rejections.length > 0 ? (
        <div className="flex flex-col gap-8">
          {upload.rejections.map((r) => (
            <Alert key={r.id} variant="error" title="That file wasn’t added">
              <span className="flex items-center gap-10">
                <span>{r.message}</span>
                <button
                  type="button"
                  onClick={() => upload.dismissRejection(r.id)}
                  className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
                >
                  Dismiss
                </button>
              </span>
            </Alert>
          ))}
        </div>
      ) : null}

      {uploadsQuery.isError ? (
        <p className="text-[13px] text-ink-faint">
          Couldn’t load the upload jobs. Reload to try again.
        </p>
      ) : finalRows.length === 0 ? (
        uploadsQuery.isLoading ? (
          <p className="text-[13px] text-ink-faint">Loading media…</p>
        ) : (
          <p className="text-[13px] text-ink-faint">No media uploaded yet.</p>
        )
      ) : (
        <div className="flex flex-col">
          {finalRows.map((row) => (
            <UploadRowView
              key={row.key}
              row={row}
              onRetryLocal={upload.retry}
              onCancel={upload.cancel}
              onRetryServer={openPickerForRetry}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------------------- */

interface UploadRowViewProps {
  row: UploadRow;
  onRetryLocal: (clientId: string) => void;
  onCancel: (clientId: string) => void;
  onRetryServer: (jobId: string) => void;
}

function UploadRowView({
  row,
  onRetryLocal,
  onCancel,
  onRetryServer,
}: UploadRowViewProps) {
  const failed = row.state === "failed";
  const stalled = row.state === "stalled";
  const size = row.sizeBytes != null ? formatBytes(row.sizeBytes) : null;

  return (
    <div
      data-slot="upload-job"
      data-state={row.state}
      className={cn(
        "flex flex-col gap-6 border-t border-border-subtle px-2 py-14 first:border-t-0",
        failed && "-mx-2 rounded-8 bg-[#FCF8F8] px-4",
      )}
    >
      <div className="flex items-center justify-between gap-12">
        <span className="truncate text-[13.5px] font-semibold text-ink">
          {row.filename}
        </span>
        {row.badgeStatus ? (
          <StatusBadge
            status={row.badgeStatus}
            label={row.state === "processing" ? "Processing" : undefined}
            className="shrink-0"
          />
        ) : null}
      </div>

      {row.state === "uploading" ? (
        <>
          <Progress
            value={row.pct ?? 0}
            variant="upload"
            label={`Uploading ${row.filename}`}
          />
          <p className="font-mono text-[12px] leading-[1.5] text-ink-muted">
            {row.progressLabel}
          </p>
          {row.etaLabel ? (
            <p className="text-[12px] text-ink-faint">{row.etaLabel}</p>
          ) : null}
          {row.pct !== null ? (
            <button
              type="button"
              onClick={() => onCancel(row.key)}
              className="w-fit text-[12px] font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
            >
              Cancel
            </button>
          ) : null}
        </>
      ) : null}

      {row.state === "processing" ? (
        <>
          <Progress
            value={100}
            variant="transcode"
            label={`Processing ${row.filename}`}
          />
          <p className="text-[12.5px] text-ink-muted">{row.subLine}</p>
        </>
      ) : null}

      {row.state === "ready" ? (
        <p className="text-[12.5px] text-ink-muted">{row.subLine}</p>
      ) : null}

      {(failed || stalled) && row.errorMessage ? (
        <p className="font-mono text-[12px] leading-[1.5] text-rose">
          {row.errorMessage}
        </p>
      ) : null}
      {stalled && !row.errorMessage && row.subLine ? (
        <p className="text-[12.5px] text-ink-muted">{row.subLine}</p>
      ) : null}
      {(failed || stalled) && size ? (
        <p className="text-[12px] text-ink-faint">{size}</p>
      ) : null}

      {(failed || stalled) && row.retry ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (row.retry?.kind === "local") {
                onRetryLocal(row.retry.clientId);
              } else if (row.retry?.kind === "server") {
                onRetryServer(row.retry.jobId);
              }
            }}
          >
            Retry upload
          </Button>
        </div>
      ) : null}
    </div>
  );
}

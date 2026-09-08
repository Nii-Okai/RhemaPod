/**
 * Merge the optimistic client uploads with the polled `UploadJobPublic[]` into
 * one ordered, de-duplicated row list (plan §A.5 "State mapping" table + §A.4
 * "once the job appears in the server list … defer to the server state").
 *
 * Rules:
 *  - Dedupe by job id. A local row that has reached the server (`jobId` present
 *    in the server list) yields to the server row — UNLESS the local row is in
 *    `error` (a PUT/confirm failure the server doesn't know about): then the
 *    local error row wins and its server twin is suppressed.
 *  - A local row still `preparing`/`uploading`/`confirming` has no server twin
 *    yet (or only an `awaiting_upload` stub) — render it from local state and
 *    suppress any `awaiting_upload` twin.
 *  - A Retry supersedes its previous job: `retryOfJobId` is removed from the
 *    server list so the old Failed row doesn't linger beside the new attempt.
 *    Because that local row is released once the *new* job lands in the poll
 *    (or on any reload), the caller also passes a provider-lifetime
 *    `supersededJobIds` set so the dead `awaiting_upload` twin does not
 *    resurrect as an actionable "didn't finish" row next to the good one.
 *  - Order: in-flight/errored local rows first (newest work on top), then the
 *    server list in its own `created_at desc` order.
 */

import { formatBytes, formatDuration } from "@/lib/format";

import type { UploadJobPublic } from "./api";
import { describeUploadFailure, ProcessingError } from "./errors";
import { formatEta } from "./eta";
import type { LocalUpload, UploadRow } from "./types";

const NO_SUPERSEDED: ReadonlySet<string> = new Set();

export interface MergeContext {
  /** Sermon duration (seconds) for the "audio · 31:02 · …" ready sub-line —
   *  `UploadJobPublic` carries no duration, so it comes off the sermon detail. */
  durationSeconds?: number | null;
  /** Rendition count from `GET /sermons/{id}/media`, or `null` if not loaded. */
  renditionCount?: number | null;
}

function localRow(u: LocalUpload): UploadRow {
  const base = {
    key: u.clientId,
    filename: u.filename,
    sizeBytes: u.sizeBytes,
    mediaType: u.mediaType,
  };

  if (u.phase === "error") {
    return {
      ...base,
      state: "failed",
      pct: null,
      progressLabel: null,
      etaLabel: null,
      subLine: null,
      errorMessage: u.error?.message ?? "The upload failed.",
      badgeStatus: "failed",
      retry: { kind: "local", clientId: u.clientId },
    };
  }

  if (u.phase === "processing") {
    return {
      ...base,
      state: "processing",
      pct: 100,
      progressLabel: null,
      etaLabel: null,
      subLine: `${u.mediaType} · preparing renditions…`,
      errorMessage: null,
      badgeStatus: "processing",
      retry: null,
    };
  }

  if (u.phase === "preparing") {
    return {
      ...base,
      state: "uploading",
      pct: null,
      progressLabel: "Requesting upload link…",
      etaLabel: null,
      subLine: null,
      errorMessage: null,
      badgeStatus: null,
      retry: null,
    };
  }

  if (u.phase === "confirming") {
    return {
      ...base,
      state: "uploading",
      pct: 100,
      progressLabel: "Finalizing…",
      etaLabel: null,
      subLine: null,
      errorMessage: null,
      badgeStatus: null,
      retry: null,
    };
  }

  // uploading
  const total = u.sizeBytes || 1;
  const pct = Math.max(0, Math.min(100, Math.round((u.bytesSent / total) * 100)));
  return {
    ...base,
    state: "uploading",
    pct,
    progressLabel: `${pct}% · ${formatBytes(u.bytesSent)} / ${formatBytes(
      u.sizeBytes,
    )}`,
    etaLabel: `Uploading — ${formatEta(u.etaSeconds)}`,
    subLine: null,
    errorMessage: null,
    badgeStatus: null,
    retry: null,
  };
}

function serverRow(job: UploadJobPublic, ctx: MergeContext): UploadRow {
  const base = {
    key: job.id,
    filename: job.original_filename ?? "Uploaded file",
    sizeBytes: job.size_bytes ?? null,
    mediaType: job.media_type,
  };

  switch (job.status) {
    case "awaiting_upload":
      // A ticket with no confirmed object — a reload lost the in-flight PUT, or
      // it never started. Honest, non-alarming: offer a fresh attempt.
      return {
        ...base,
        state: "stalled",
        pct: null,
        progressLabel: null,
        etaLabel: null,
        subLine: "This upload didn’t finish — retry to replace it.",
        errorMessage: null,
        badgeStatus: "awaiting_upload",
        retry: {
          kind: "server",
          jobId: job.id,
          filename: job.original_filename ?? null,
        },
      };
    case "uploaded":
    case "processing":
      return {
        ...base,
        state: "processing",
        pct: 100,
        progressLabel: null,
        etaLabel: null,
        subLine: `${job.media_type} · preparing renditions…`,
        errorMessage: null,
        badgeStatus: "processing",
        retry: null,
      };
    case "ready": {
      const segs: string[] = [job.media_type];
      const dur = formatDuration(ctx.durationSeconds ?? null);
      if (dur !== "—") segs.push(dur);
      if (ctx.renditionCount != null) {
        segs.push(
          `${ctx.renditionCount} rendition${
            ctx.renditionCount === 1 ? "" : "s"
          } ready`,
        );
      }
      return {
        ...base,
        state: "ready",
        pct: null,
        progressLabel: null,
        etaLabel: null,
        subLine: segs.join(" · "),
        errorMessage: null,
        badgeStatus: "ready",
        retry: null,
      };
    }
    case "failed":
      return {
        ...base,
        state: "failed",
        pct: null,
        progressLabel: null,
        etaLabel: null,
        subLine: null,
        // Verbatim server `error_message` (design), via the one typed carrier
        // for surface 6 so the copy path is single-sourced.
        errorMessage: describeUploadFailure(
          new ProcessingError(job.error_message ?? "Processing failed."),
        ).message,
        badgeStatus: "failed",
        retry: {
          kind: "server",
          jobId: job.id,
          filename: job.original_filename ?? null,
        },
      };
  }
}

export function mergeUploadRows(
  local: LocalUpload[],
  server: UploadJobPublic[],
  ctx: MergeContext = {},
  /** Job ids a Retry has permanently superseded — kept for the provider's
   *  lifetime by the caller, so a reconcile/reload can't resurrect the dead
   *  `awaiting_upload` twin (and each stalled-retry click leaking another
   *  raw-bucket object). Cleanup of the orphaned job itself needs a backend
   *  cancel/delete route — see status.md `[GATE 3 Batch 3]`. */
  supersededJobIds: ReadonlySet<string> = NO_SUPERSEDED,
): UploadRow[] {
  const suppressed = new Set<string>(supersededJobIds);
  for (const u of local) {
    if (u.retryOfJobId) suppressed.add(u.retryOfJobId);
  }

  const localRows: UploadRow[] = [];
  for (const u of local) {
    if (u.jobId && u.phase === "processing") {
      // The server row will carry it once the poll catches up; until then show
      // the local optimistic "processing" row.
      const twin = server.find((j) => j.id === u.jobId);
      if (twin) {
        continue; // server wins
      }
    }
    if (u.jobId && u.phase !== "error" && u.phase !== "processing") {
      // Pre-confirm: hide any awaiting_upload stub the ticket created.
      suppressed.add(u.jobId);
    }
    if (u.jobId && u.phase === "error") {
      // Failure the server can't see (PUT/confirm) — our row, not its stub.
      suppressed.add(u.jobId);
    }
    localRows.push(localRow(u));
  }

  const serverRows: UploadRow[] = [];
  const seen = new Set<string>();
  for (const job of server) {
    if (suppressed.has(job.id) || seen.has(job.id)) continue;
    seen.add(job.id);
    serverRows.push(serverRow(job, ctx));
  }

  return [...localRows, ...serverRows];
}

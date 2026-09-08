/**
 * Shared shapes for the upload pipeline (plan §A.5). `LocalUpload` is the
 * optimistic client-side record the `UploadProvider` holds; `UploadRow` is the
 * normalized view the Media card renders after merging local + server state.
 */

import type { UploadJobPublic } from "./api";
import type { UploadFailureSurface } from "./errors";

export type LocalPhase =
  | "preparing" // requesting a ticket
  | "uploading" // XHR PUT in flight
  | "confirming" // PUT done, calling …/confirm
  | "processing" // confirm done; waiting for the server job to appear
  | "error";

export interface LocalUpload {
  /** Stable per row, survives a Retry (the row's identity). */
  clientId: string;
  /** Set once a ticket is issued; `null` before, and again during a Retry. */
  jobId: string | null;
  /** A previous job id this row is superseding (Retry) — suppressed from the
   *  server list in the merge so the failed twin doesn't double up. */
  retryOfJobId: string | null;
  filename: string;
  sizeBytes: number;
  mediaType: "video" | "audio";
  /** Canonical `Content-Type` the ticket is signed with and the PUT sends. */
  contentType: string;
  phase: LocalPhase;
  bytesSent: number;
  etaSeconds: number | null;
  error: { surface: UploadFailureSurface; message: string } | null;
}

export type UploadRowState =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "stalled";

export interface UploadRow {
  key: string;
  state: UploadRowState;
  filename: string;
  sizeBytes: number | null;
  mediaType: "video" | "audio" | null;
  /** uploading: 0–100 (or null while preparing/confirming = indeterminate). */
  pct: number | null;
  /** uploading: "1.4 / 2.2 GB" style byte line, or a phase label. */
  progressLabel: string | null;
  /** uploading: trailing "Uploading — N min remaining" clause. */
  etaLabel: string | null;
  /** processing / ready: the sub-line under the filename. */
  subLine: string | null;
  /** failed / stalled: verbatim reason. */
  errorMessage: string | null;
  /** The badge status to hand `<StatusBadge>` (processing/ready/failed/stalled).
   *  `null` for the client-only "uploading" phase, which has no badge. */
  badgeStatus: UploadJobPublic["status"] | null;
  /** Retry affordance. `local` = we still hold the File (one click). `server` =
   *  the File is gone (reload / polled-to-failed) → re-pick required. */
  retry:
    | { kind: "local"; clientId: string }
    | { kind: "server"; jobId: string; filename: string | null }
    | null;
}

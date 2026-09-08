/**
 * `UploadProvider` — the in-progress-upload store, mounted ABOVE the editor
 * form body so form fields, autosave and Submit stay live during a multi-GB
 * PUT (plan §A.5 "Not blocking the form"). It owns:
 *
 *  - the optimistic `LocalUpload` map (progress lives here until the server job
 *    appears in the poll, then the merge defers to server state — plan §A.4);
 *  - the XHR abort handles;
 *  - the retry mechanism (Retry = a brand-new ticket + PUT, never a re-confirm
 *    — plan §A.5);
 *  - pre-flight `rejections` (bad type / oversize) shown as a dismissable alert;
 *  - the `beforeunload` guard while any PUT is live.
 *
 * The file bytes never enter this module — `runUpload` calls `requestTicket` /
 * `confirmUpload` through the BFF and `putFileWithProgress` direct to storage.
 */

"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";

import { confirmUpload, requestTicket } from "./api";
import { readMediaDuration } from "./duration";
import {
  UploadAbortedError,
  describeUploadFailure,
} from "./errors";
import { UploadRateEstimator } from "./eta";
import type { LocalUpload } from "./types";
import { validateMediaFile } from "./validate";
import { putFileWithProgress } from "./xhr-put";

const PROGRESS_COMMIT_MS = 120;

export interface UploadRejection {
  id: string;
  filename: string;
  message: string;
}

interface UploadContextValue {
  uploads: LocalUpload[];
  rejections: UploadRejection[];
  /** Job ids a Retry has permanently superseded. Held for the provider's
   *  lifetime and handed to `mergeUploadRows` so the dead `awaiting_upload`
   *  twin can't resurrect after a reconcile. */
  supersededJobIds: ReadonlySet<string>;
  /** True while any upload is preparing / uploading / confirming. Drives the
   *  `beforeunload` guard and the caller's own nav guard. */
  hasActiveUploads: boolean;
  /** Queue one or more freshly-picked files. Invalid ones become `rejections`. */
  enqueue: (files: File[]) => void;
  /** Retry a failed LOCAL row — the File is still in memory, one click. */
  retry: (clientId: string) => void;
  /** Retry a failed/stalled SERVER row — the File is gone, caller re-picks it. */
  retryServer: (jobId: string, file: File) => void;
  /** Cancel an in-flight upload and drop its row. */
  cancel: (clientId: string) => void;
  dismissRejection: (id: string) => void;
  /** Drop local rows whose job has landed in the server list (releases the
   *  File). Called by the Media card once it has the polled jobs. */
  reconcile: (serverJobIds: readonly string[]) => void;
}

const UploadContext = React.createContext<UploadContextValue | null>(null);

export function useUploadContext(): UploadContextValue {
  const ctx = React.useContext(UploadContext);
  if (!ctx) {
    throw new Error("useUploadContext must be used within <UploadProvider>");
  }
  return ctx;
}

export interface UploadProviderProps {
  /** The saved sermon's id. `undefined` for an unsaved `/sermons/new` draft —
   *  `enqueue` rejects until it is set. */
  sermonId: string | undefined;
  /** Stall-watchdog window for the direct PUT, forwarded to
   *  `putFileWithProgress`. Defaults to `STALL_TIMEOUT_MS`; overridden only by
   *  tests that need the watchdog to fire fast. */
  stallMs?: number;
  children: React.ReactNode;
}

const ACTIVE_PHASES: ReadonlySet<LocalUpload["phase"]> = new Set([
  "preparing",
  "uploading",
  "confirming",
]);

export function UploadProvider({
  sermonId,
  stallMs,
  children,
}: UploadProviderProps) {
  const qc = useQueryClient();

  const [uploads, setUploads] = React.useState<Record<string, LocalUpload>>({});
  const [rejections, setRejections] = React.useState<UploadRejection[]>([]);
  const [supersededJobIds, setSupersededJobIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set());

  // Refs mirror state / hold non-render data for the async pipeline.
  const stateRef = React.useRef<Record<string, LocalUpload>>({});
  const filesRef = React.useRef<Map<string, File>>(new Map());
  const abortRef = React.useRef<Map<string, () => void>>(new Map());
  const cancelledRef = React.useRef<Set<string>>(new Set());
  // clientIds whose `runUpload` is currently executing — a second call for the
  // same id (fast double-click Retry) is a no-op, so it can't mint a second
  // ticket/job/PUT and orphan the first abort handle.
  const runningRef = React.useRef<Set<string>>(new Set());
  const lastCommitRef = React.useRef<Map<string, number>>(new Map());
  const sermonIdRef = React.useRef<string | undefined>(sermonId);
  const stallMsRef = React.useRef<number | undefined>(stallMs);

  React.useEffect(() => {
    sermonIdRef.current = sermonId;
  }, [sermonId]);
  React.useEffect(() => {
    stallMsRef.current = stallMs;
  }, [stallMs]);

  const markSuperseded = React.useCallback((jobId: string) => {
    setSupersededJobIds((prev) =>
      prev.has(jobId) ? prev : new Set(prev).add(jobId),
    );
  }, []);

  const commit = React.useCallback(
    (next: Record<string, LocalUpload>) => {
      stateRef.current = next;
      setUploads(next);
    },
    [],
  );

  const patch = React.useCallback(
    (clientId: string, partial: Partial<LocalUpload>) => {
      const cur = stateRef.current[clientId];
      if (!cur) return;
      commit({ ...stateRef.current, [clientId]: { ...cur, ...partial } });
    },
    [commit],
  );

  const remove = React.useCallback(
    (clientId: string) => {
      filesRef.current.delete(clientId);
      abortRef.current.delete(clientId);
      runningRef.current.delete(clientId);
      lastCommitRef.current.delete(clientId);
      cancelledRef.current.delete(clientId);
      if (!stateRef.current[clientId]) return;
      const next = { ...stateRef.current };
      delete next[clientId];
      commit(next);
    },
    [commit],
  );

  const invalidateForSermon = React.useCallback(
    (id: string) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sermons.uploads(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.sermons.media(id) });
      void qc.invalidateQueries({
        queryKey: queryKeys.sermons.detail(id),
        exact: true,
      });
    },
    [qc],
  );

  const runUpload = React.useCallback(
    async (clientId: string) => {
      // Re-entrancy guard: a second invocation for a clientId already running
      // (double-click Retry) is a no-op.
      if (runningRef.current.has(clientId)) return;

      const file = filesRef.current.get(clientId);
      const entry = stateRef.current[clientId];
      if (!file || !entry) return;

      runningRef.current.add(clientId);

      const estimator = new UploadRateEstimator();
      const abortController = new AbortController();
      abortRef.current.set(clientId, () => abortController.abort());
      lastCommitRef.current.set(clientId, 0);

      const cancelled = () => cancelledRef.current.has(clientId);

      try {
        const sid = sermonIdRef.current;
        if (!sid) {
          patch(clientId, {
            phase: "error",
            error: {
              surface: "ticket",
              message: "Save the draft before adding media.",
              retryable: true,
            },
          });
          return;
        }

        patch(clientId, { phase: "preparing", error: null, bytesSent: 0 });

        const ticket = await requestTicket({
          sermonId: sid,
          filename: entry.filename,
          contentType: entry.contentType,
          mediaType: entry.mediaType,
          sizeBytes: entry.sizeBytes,
        });
        if (cancelled()) {
          remove(clientId);
          return;
        }
        patch(clientId, { jobId: ticket.job_id, phase: "uploading" });

        // Duration read runs alongside the PUT; a failure is non-fatal.
        const durationPromise = readMediaDuration(file, entry.mediaType);
        const putContentType =
          ticket.headers?.["Content-Type"] ?? entry.contentType;

        await putFileWithProgress(ticket.upload_url, file, {
          contentType: putContentType,
          signal: abortController.signal,
          stallMs: stallMsRef.current,
          onProgress: ({ loaded, total }) => {
            const now = Date.now();
            estimator.sample(loaded, now);
            const last = lastCommitRef.current.get(clientId) ?? 0;
            if (now - last < PROGRESS_COMMIT_MS && loaded < total) return;
            lastCommitRef.current.set(clientId, now);
            patch(clientId, {
              bytesSent: loaded,
              etaSeconds: estimator.remainingSeconds(total),
            });
          },
        });
        if (cancelled()) {
          remove(clientId);
          return;
        }

        patch(clientId, {
          phase: "confirming",
          bytesSent: entry.sizeBytes,
          etaSeconds: null,
        });
        // The metadata read of a *local* File is near-instant; cap the wait so a
        // browser that stalls on it can't hold `confirm` back (the backend only
        // fills a blank duration anyway).
        const duration = await Promise.race([
          durationPromise.catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 4000)),
        ]);
        const job = await confirmUpload(ticket.job_id, duration);
        if (cancelled()) {
          remove(clientId);
          return;
        }

        patch(clientId, { phase: "processing", jobId: job.id });
        invalidateForSermon(sid);
      } catch (err) {
        if (err instanceof UploadAbortedError || cancelled()) {
          remove(clientId);
          return;
        }
        patch(clientId, {
          phase: "error",
          error: describeUploadFailure(err),
        });
      } finally {
        abortRef.current.delete(clientId);
        runningRef.current.delete(clientId);
      }
    },
    [patch, remove, invalidateForSermon],
  );

  const enqueue = React.useCallback(
    (files: File[]) => {
      const newRejections: UploadRejection[] = [];
      const toStart: string[] = [];
      let next = { ...stateRef.current };

      for (const file of files) {
        const v = validateMediaFile(file);
        if (!v.ok) {
          newRejections.push({
            id: crypto.randomUUID(),
            filename: file.name,
            message: v.message,
          });
          continue;
        }
        const clientId = crypto.randomUUID();
        filesRef.current.set(clientId, file);
        next = {
          ...next,
          [clientId]: {
            clientId,
            jobId: null,
            retryOfJobId: null,
            filename: file.name,
            sizeBytes: file.size,
            mediaType: v.kind,
            contentType: v.contentType,
            phase: "preparing",
            bytesSent: 0,
            etaSeconds: null,
            error: null,
          },
        };
        toStart.push(clientId);
      }

      if (Object.keys(next).length !== Object.keys(stateRef.current).length) {
        commit(next);
      }
      if (newRejections.length) {
        setRejections((r) => [...r, ...newRejections]);
      }
      for (const id of toStart) void runUpload(id);
    },
    [commit, runUpload],
  );

  const retry = React.useCallback(
    (clientId: string) => {
      const cur = stateRef.current[clientId];
      if (!cur) return;
      if (!filesRef.current.has(clientId)) return;
      if (runningRef.current.has(clientId)) return; // double-click guard
      cancelledRef.current.delete(clientId);
      const supersededId = cur.jobId ?? cur.retryOfJobId;
      if (supersededId) markSuperseded(supersededId);
      patch(clientId, {
        jobId: null,
        retryOfJobId: supersededId,
        phase: "preparing",
        bytesSent: 0,
        etaSeconds: null,
        error: null,
      });
      void runUpload(clientId);
    },
    [patch, runUpload, markSuperseded],
  );

  const retryServer = React.useCallback(
    (jobId: string, file: File) => {
      const v = validateMediaFile(file);
      if (!v.ok) {
        setRejections((r) => [
          ...r,
          { id: crypto.randomUUID(), filename: file.name, message: v.message },
        ]);
        return;
      }
      markSuperseded(jobId);
      const clientId = crypto.randomUUID();
      filesRef.current.set(clientId, file);
      commit({
        ...stateRef.current,
        [clientId]: {
          clientId,
          jobId: null,
          retryOfJobId: jobId,
          filename: file.name,
          sizeBytes: file.size,
          mediaType: v.kind,
          contentType: v.contentType,
          phase: "preparing",
          bytesSent: 0,
          etaSeconds: null,
          error: null,
        },
      });
      void runUpload(clientId);
    },
    [commit, runUpload, markSuperseded],
  );

  const cancel = React.useCallback(
    (clientId: string) => {
      cancelledRef.current.add(clientId);
      abortRef.current.get(clientId)?.();
      remove(clientId);
    },
    [remove],
  );

  const dismissRejection = React.useCallback((id: string) => {
    setRejections((r) => r.filter((x) => x.id !== id));
  }, []);

  const reconcile = React.useCallback(
    (serverJobIds: readonly string[]) => {
      const ids = new Set(serverJobIds);
      for (const entry of Object.values(stateRef.current)) {
        if (entry.phase === "processing" && entry.jobId && ids.has(entry.jobId)) {
          remove(entry.clientId);
        }
      }
    },
    [remove],
  );

  const uploadList = React.useMemo(() => Object.values(uploads), [uploads]);
  const hasActiveUploads = React.useMemo(
    () => uploadList.some((u) => ACTIVE_PHASES.has(u.phase)),
    [uploadList],
  );

  // `beforeunload` while a PUT is live — the XHR dies with the page and there
  // is no resume (plan §A.5).
  React.useEffect(() => {
    if (!hasActiveUploads) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasActiveUploads]);

  // On unmount, abort every in-flight PUT so a torn-down editor leaves nothing
  // hanging.
  React.useEffect(() => {
    const aborts = abortRef.current;
    return () => {
      for (const abort of aborts.values()) abort();
    };
  }, []);

  const value = React.useMemo<UploadContextValue>(
    () => ({
      uploads: uploadList,
      rejections,
      supersededJobIds,
      hasActiveUploads,
      enqueue,
      retry,
      retryServer,
      cancel,
      dismissRejection,
      reconcile,
    }),
    [
      uploadList,
      rejections,
      supersededJobIds,
      hasActiveUploads,
      enqueue,
      retry,
      retryServer,
      cancel,
      dismissRejection,
      reconcile,
    ],
  );

  return (
    <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
  );
}

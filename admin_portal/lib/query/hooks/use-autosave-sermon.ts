/**
 * `useAutosaveSermon` — the editor's autosave engine (W8, plan §A.4).
 *
 * Behaviour, exactly as specified:
 *
 *  - **Debounce.** Any tracked-field change calls `queue(patch)`, which merges
 *    the patch into a single pending payload and (re)arms a 2s timer.
 *  - **Flush on blur / Save draft / unmount.** `flush()` cancels the timer and
 *    saves immediately and returns a promise the caller can await (so a submit
 *    never races a debounced PATCH). The unmount cleanup flushes a last time
 *    **only in edit-mode** — an abandoned `/sermons/new` that never got a title
 *    creates nothing. The request is issued through the module `api` client,
 *    not a component-scoped mutation, so it still completes after the tree is
 *    gone — only the `setState`s (and `onCreated`) are suppressed.
 *  - **One automatic retry on a transient failure.** A network error or a 5xx
 *    schedules a single delayed retry so a blip self-heals; a 4xx never
 *    retries, and a second failure stays "Not saved" until the user acts.
 *  - **Serialized queue, coalesced payload.** At most one request in flight;
 *    edits made mid-flight accumulate and are sent as one follow-up PATCH when
 *    it settles — never a queue of racing requests.
 *  - **new → edit transition.** With no `sermonId`, the first save is
 *    `POST /sermons` (needs a non-empty title; until it has one, `queue` just
 *    accumulates). On success the hook flips to PATCH-mode against the new id
 *    and calls `onCreated(newId)` — the editor updates the URL with
 *    `history.replaceState` so focus and form state survive (the App Router has
 *    no shallow `router.replace`, and a real navigation would remount).
 *  - **The stamp.** `status` drives the mono "saved N min ago" line:
 *    `saving` → "Saving…", `saved` → relative time from `savedAt`, `error` →
 *    "Not saved". `savedAt` is the last *successful* save time (or the server
 *    `updated_at` baseline), never the dirty flag (§A.4).
 *  - **A failed save never drops edits.** The rejected payload is merged back
 *    under any newer pending edits and retried on the next trigger (blur, Save
 *    draft, or the next keystroke's debounce).
 *
 * The React Compiler is on: this hook keeps its mutable machinery in refs and
 * exposes progress as state, so nothing reads a ref during render.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type SermonTier = components["schemas"]["ContentTier"] | null;

/** Wire bodies — the tracked partial lines up 1:1 with these, so no cast. */
type SermonCreateBody = components["schemas"]["SermonCreate"];
type SermonUpdateBody = components["schemas"]["SermonUpdate"];

/** The subset of the sermon the editor form owns. Field names line up 1:1 with
    `SermonCreate` / `SermonUpdate`, so a tracked partial is also the wire
    payload. */
export interface SermonFormValues {
  title: string;
  description: string;
  speaker_id: string | null;
  category_id: string | null;
  series_id: string | null;
  episode_number: number | null;
  tier: SermonTier;
  tags: string[];
}

export type SermonPatch = Partial<SermonFormValues>;

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutosaveSermonOptions {
  /** Undefined until the first `POST /sermons` resolves; then the created id. */
  sermonId: string | undefined;
  /** Server `updated_at` — the stamp's starting point before any client save. */
  baselineSavedAt?: string | null;
  /** Called once, with the new id, right after the create POST succeeds. */
  onCreated: (newId: string) => void;
  /** Debounce window. Defaults to 2000ms (§A.4); overridable so a test can run
      on real timers with a short window. */
  debounceMs?: number;
  /** Delay before the single automatic retry of a transient (network / 5xx)
      failure. Defaults to 4000ms; overridable for tests. */
  retryMs?: number;
}

export interface UseAutosaveSermonResult {
  status: AutosaveStatus;
  /** ms epoch of the last successful save, or the server baseline, or null. */
  savedAt: number | null;
  /** Present only while `status === "error"`. */
  errorMessage: string | null;
  /** Merge a field change into the pending payload and arm the 2s debounce. */
  queue: (patch: SermonPatch) => void;
  /** Save now — blur, the explicit Save draft button. Resolves when the
      in-flight save (if any) settles, so callers can `await` it before a
      workflow transition. */
  flush: () => Promise<void>;
  /** Pending edits exist or a save is in flight. */
  isDirty: boolean;
}

// Exported so other editors that mirror this debounce (the announcement
// editor's auto-draft-on-title, review-fix batch item 8) share one source of
// truth instead of a second hardcoded "2000".
export const DEFAULT_DEBOUNCE_MS = 2000;
const DEFAULT_RETRY_MS = 4000;

function messageFor(err: unknown): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return "Your last change didn’t save. It’ll retry — or use Save draft.";
}

function hasKeys(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

export function useAutosaveSermon(
  options: UseAutosaveSermonOptions,
): UseAutosaveSermonResult {
  const qc = useQueryClient();

  const idRef = useRef<string | undefined>(options.sermonId);
  const onCreatedRef = useRef(options.onCreated);
  const pendingRef = useRef<SermonPatch>({});
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One automatic retry per failed flush: set true when we schedule it, back
  // to false on a success or any fresh user action (queue / flush).
  const autoRetriedRef = useRef(false);
  const mountedRef = useRef(true);
  const runFlushRef = useRef<() => Promise<void>>(async () => {});

  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(() =>
    options.baselineSavedAt ? Date.parse(options.baselineSavedAt) : null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Keep the id in sync when the prop catches up (post-create URL change), but
  // never let it fall back to undefined once we have one.
  useEffect(() => {
    if (options.sermonId) idRef.current = options.sermonId;
  }, [options.sermonId]);

  // Adopt the server `updated_at` baseline once it arrives, but only while
  // nothing has been saved client-side yet — so the stamp reads "saved 3 min
  // ago" on a freshly opened sermon, not a blank until the first edit.
  const { baselineSavedAt } = options;
  useEffect(() => {
    if (baselineSavedAt && savedAt == null && !inFlightRef.current) {
      setSavedAt(Date.parse(baselineSavedAt));
    }
  }, [baselineSavedAt, savedAt]);

  // The core save routine. Rebuilt each render (closes over `qc` + setters,
  // which are stable) and stashed in a ref so the timer, the unmount cleanup
  // and the returned `flush` always call the latest version without making it a
  // hook dependency.
  const runFlush = async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (inFlightRef.current) return;
    if (!hasKeys(pendingRef.current)) return;

    const creating = idRef.current == null;
    const usableTitle =
      typeof pendingRef.current.title === "string" &&
      pendingRef.current.title.trim().length > 0;

    // Create mode with no usable title yet — hold the pending edits, don't fire.
    if (creating && !usableTitle) {
      if (mountedRef.current) setStatus("idle");
      return;
    }

    const payload = pendingRef.current;
    pendingRef.current = {};
    inFlightRef.current = true;
    if (mountedRef.current) {
      setStatus("saving");
      setErrorMessage(null);
      setIsDirty(true);
    }

    let errored = false;
    try {
      if (creating) {
        const body: SermonCreateBody = {
          ...payload,
          title: (payload.title ?? "").trim(),
        };
        const created = await unwrap(api.POST("/api/v1/sermons", { body }));
        idRef.current = created.id;
        // Only touch the URL / parent state if this hook is still mounted — an
        // abandoned /sermons/new whose POST resolves late must not rewrite the
        // address bar of whatever page the user is now on.
        if (mountedRef.current) onCreatedRef.current(created.id);
      } else {
        const body: SermonUpdateBody = payload;
        await unwrap(
          api.PATCH("/api/v1/sermons/{sermon_id}", {
            params: { path: { sermon_id: idRef.current as string } },
            body,
          }),
        );
      }
      const now = Date.now();
      autoRetriedRef.current = false;
      if (mountedRef.current) {
        setSavedAt(now);
        setErrorMessage(null);
      }
      qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.counts() });
      qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
    } catch (err) {
      errored = true;
      // Newer edits (queued while this was in flight) win over the failed ones.
      pendingRef.current = { ...payload, ...pendingRef.current };
      if (mountedRef.current) {
        setStatus("error");
        setErrorMessage(messageFor(err));
        setIsDirty(true);
      }
      // A transient failure (offline, or a backend 5xx) gets exactly one
      // automatic retry so a blip self-heals without a user action. A 4xx is a
      // real rejection — never retried. A further failure holds at "Not saved"
      // until the user acts (queue / flush reset the budget).
      const transient = !isApiError(err) || err.status >= 500;
      if (
        transient &&
        !autoRetriedRef.current &&
        mountedRef.current &&
        hasKeys(pendingRef.current)
      ) {
        autoRetriedRef.current = true;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void runFlushRef.current();
        }, options.retryMs ?? DEFAULT_RETRY_MS);
      }
    } finally {
      inFlightRef.current = false;
      if (!errored) {
        if (hasKeys(pendingRef.current)) {
          void runFlushRef.current();
        } else if (mountedRef.current) {
          setStatus("saved");
          setIsDirty(false);
        }
      }
    }
  };

  // Publish the latest closure + `onCreated` into refs after commit, so the
  // timer / unmount / returned `flush` always invoke the current version
  // without depending on it (no ref writes during render).
  useEffect(() => {
    runFlushRef.current = runFlush;
    onCreatedRef.current = options.onCreated;
  });

  const queue = (patch: SermonPatch): void => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    // A fresh edit restores the automatic-retry budget and cancels any pending
    // retry — the debounce below carries the new value instead.
    autoRetriedRef.current = false;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    // Don't flash "Saving…" on /sermons/new before there's a title to POST —
    // nothing is going to fire until one exists.
    const willFire =
      idRef.current != null ||
      (typeof pendingRef.current.title === "string" &&
        pendingRef.current.title.trim().length > 0);
    if (willFire) {
      setStatus("saving");
      setErrorMessage(null);
    }
    setIsDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => void runFlushRef.current(),
      options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    );
  };

  const flush = (): Promise<void> => {
    // An explicit user flush (blur, Save draft, submit) restores the retry
    // budget too.
    autoRetriedRef.current = false;
    return runFlushRef.current();
  };

  // Flush once more on unmount. The fetch is issued through `api` (module
  // scope), so it outlives the component; `mountedRef` gates the setStates.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Mark unmounted FIRST so runFlush's synchronous setStatus/setIsDirty
      // prologue can't run on a dead hook.
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      // Flush a last time ONLY in edit-mode. An abandoned /sermons/new that
      // never got a title must create nothing — a silent create-on-unmount is
      // a sermon the user never asked for.
      if (
        idRef.current != null &&
        hasKeys(pendingRef.current) &&
        !inFlightRef.current
      ) {
        void runFlushRef.current();
      }
    };
  }, []);

  return { status, savedAt, errorMessage, queue, flush, isDirty };
}

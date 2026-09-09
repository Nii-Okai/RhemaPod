/**
 * `useReviewActions` — the Review queue's four approval transitions (W10).
 *
 * Sibling of `useSermonWorkflow` / `useEditorWorkflow`: optimistic status
 * transitions with rollback (plan §A.4), failures surfaced through an
 * `onError(vars, message)` string callback that the screen renders as an
 * `<Alert>` at the top of the *affected card* — never a toast (design
 * "Errors").
 *
 *   kind            wire                                          optimistic
 *   ────            ────                                          ──────────
 *   startReview     POST …/{id}/start-review                      status → under_review,
 *                                                                 review_claimed_by(_id) → me
 *                                                                 (card stays in the queue)
 *   takeOver        POST …/{id}/take-over-review                  same claim patch as
 *                                                                 startReview; a 409 (I
 *                                                                 already hold it) is a
 *                                                                 no-op success
 *   approve         POST …/{id}/approve                           card leaves the queue
 *   approvePublish  POST …/{id}/approve → POST …/{id}/publish     card leaves the queue
 *   publish         POST …/{id}/publish                           card leaves the queue
 *                                                                 (an already-`approved`
 *                                                                 card — #12; not
 *                                                                 claim-gated)
 *   reject          POST …/{id}/reject  {note}                    card leaves the queue
 *
 * There is **no** combined "approve & publish" route — it is two ordered calls
 * (verified against `app/api/sermon_approval.py`). `publish` returns
 * `StatusResponse {id, status}` only — **no subscriber count** — so the success
 * toast is the bare "Published to the app" (gap noted for a later batch).
 *
 * Because `approve_and_publish` is two calls, it has a partial-failure mode:
 * `approve` 200s (the sermon is now `approved`, the log row is committed) and
 * then `publish` throws. `runAction` tags that failure with its **phase** via
 * `ReviewActionError { phase, approved, cause }`:
 *   - `phase === "approve"`  → nothing committed. Full rollback, generic
 *                              "Couldn’t approve …" — handled by `onError`.
 *   - `phase === "publish"`  → the approve DID commit. The card must **not**
 *                              revert to a pending badge (a lie). The row
 *                              refetches as `approved` and stays in the queue
 *                              (#12); the screen clears any half-open reject
 *                              `mode` on that card and shows a transient
 *                              card-top error, so the card lands on its
 *                              "Publish" retry — signalled via
 *                              `onApprovedNotPublished`.
 * A retried `approve_and_publish` on a sermon that is already `approved` (a
 * stale tab, or a race) skips `approve` — either because `vars.item.status`
 * already reads `approved`, or by catching the specific "already `approved`"
 * 409 from `approveCall` — and goes straight to `publish`. No 409 dead-end.
 *
 * `reject` is optimistic *here* (design Screen 5 shows the card leaving on
 * send), which is a deliberate departure from §A.4's "Reject is not optimistic"
 * for the *editor* screen: the manager's typed note is preserved by the screen
 * (it owns the per-card `note` state and only clears it on success), so a
 * rollback re-shows the textarea with the note intact — the concern §A.4 raised
 * is covered without the 400ms spinner.
 *
 * `reject` with an empty note is impossible to send: the screen disables the
 * button and guards the call, and this hook trims + rejects a blank note before
 * any request. (The backend does **not** yet enforce a non-empty note —
 * `RejectRequest.note` is optional with no validator; owed to a backend batch.)
 *
 * `onSettled` invalidates `review.queue()`, `sermons.lists()`,
 * `sermons.counts()` and `nav.counts()` (the sidebar review-queue pill).
 */

"use client";

import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import type {
  ReviewQueueItem,
  ReviewQueuePage,
} from "@/lib/query/hooks/use-review-queue";

export type ReviewActionKind =
  | "startReview"
  | "takeOver"
  | "approve"
  | "approvePublish"
  | "publish"
  | "reject";

export interface ReviewActionVars {
  kind: ReviewActionKind;
  item: ReviewQueueItem;
  /** Only for `reject` — the (already non-empty) rejection note. */
  note?: string;
}

const VERB: Record<ReviewActionKind, string> = {
  startReview: "start review on",
  takeOver: "take over review on",
  approve: "approve",
  approvePublish: "approve and publish",
  publish: "publish",
  reject: "reject",
};

/** Which leg of `approve_and_publish` threw. `approved` is whether the approve
    call committed before the failure (always true for `phase: "publish"`). */
export type ReviewActionPhase = "approve" | "publish";

export class ReviewActionError extends Error {
  readonly phase: ReviewActionPhase;
  readonly approved: boolean;
  /** The original transport error (an `ApiError`, usually). */
  override readonly cause: unknown;

  constructor(phase: ReviewActionPhase, approved: boolean, cause: unknown) {
    super(`approve_and_publish failed during the ${phase} phase`);
    this.name = "ReviewActionError";
    this.phase = phase;
    this.approved = approved;
    this.cause = cause;
    Object.setPrototypeOf(this, ReviewActionError.prototype);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled review action kind: ${String(value)}`);
}

/** The backend's "can't re-approve" 409: `resolve_transition` raises
    `Cannot 'approve' a sermon in status 'approved'` → `ContentError(409)`. Any
    other 409 (e.g. still a draft) is a real failure and must not be swallowed. */
function isAlreadyApprovedConflict(err: unknown): boolean {
  return (
    isApiError(err) &&
    err.status === 409 &&
    /in status ['’]approved['’]/i.test(err.detail)
  );
}

/** `take-over-review`'s only documented 409: the caller already holds the review
    claim — `content_service.take_over_review` raises
    `ContentError("already_reviewing", 409)`. That is the desired end-state, so
    it's a no-op success. Any other 409 (a race that resolved to a different
    transition error) is a real failure and must surface to `onError`. */
function isAlreadyReviewingConflict(err: unknown): boolean {
  return (
    isApiError(err) &&
    err.status === 409 &&
    /^already_reviewing$/i.test(err.detail.trim())
  );
}

type QueueSnapshot = Array<[readonly unknown[], ReviewQueuePage | undefined]>;

function currentQueues(qc: QueryClient): QueueSnapshot {
  return qc.getQueriesData<ReviewQueuePage>({
    queryKey: queryKeys.review.queue(),
  }) as QueueSnapshot;
}

function restoreQueues(qc: QueryClient, snapshot: QueueSnapshot): void {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

/** Drop `id` from every rendered review-queue page and decrement its total. */
function removeFromQueues(qc: QueryClient, id: string): void {
  for (const [key, data] of currentQueues(qc)) {
    if (!data) continue;
    const kept = data.items.filter((item) => item.id !== id);
    if (kept.length === data.items.length) continue;
    qc.setQueryData<ReviewQueuePage>(key, {
      ...data,
      items: kept,
      total: Math.max(0, data.total - (data.items.length - kept.length)),
    });
  }
}

/** Flip `id` to `approved` in every rendered page that still shows it. A no-op
    on the common path (the card was already removed in `onMutate`); it only
    matters for a stale tab / race where the row is still visible after an
    approve-ok / publish-fail — there it stops the card lying with a pending
    badge. */
function markApprovedInQueues(qc: QueryClient, id: string): void {
  for (const [key, data] of currentQueues(qc)) {
    if (!data) continue;
    if (!data.items.some((item) => item.id === id)) continue;
    qc.setQueryData<ReviewQueuePage>(key, {
      ...data,
      items: data.items.map((item) =>
        item.id === id
          ? { ...item, status: "approved", review_claimed_by: null }
          : item,
      ),
    });
  }
}

/** Mark `id` as claimed by `claimedBy` (the "Start review" / "Take over review"
    optimistic patch). Patches both the display name and the raw id so the card's
    claim-lock derivation (`review_claimed_by_id === me`) flips immediately, not
    only after the settle refetch. */
function claimInQueues(
  qc: QueryClient,
  id: string,
  claimedBy: string | null,
  claimedById: string | null,
): void {
  for (const [key, data] of currentQueues(qc)) {
    if (!data) continue;
    qc.setQueryData<ReviewQueuePage>(key, {
      ...data,
      items: data.items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "under_review",
              review_claimed_by: claimedBy,
              review_claimed_by_id: claimedById,
            }
          : item,
      ),
    });
  }
}

function messageFor(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return fallback;
}

const startReview = (id: string) =>
  api.POST("/api/v1/approvals/sermons/{sermon_id}/start-review", {
    params: { path: { sermon_id: id } },
  });
const takeOverCall = (id: string) =>
  api.POST("/api/v1/approvals/sermons/{sermon_id}/take-over-review", {
    params: { path: { sermon_id: id } },
  });
const approveCall = (id: string) =>
  api.POST("/api/v1/approvals/sermons/{sermon_id}/approve", {
    params: { path: { sermon_id: id } },
  });
const publishCall = (id: string) =>
  api.POST("/api/v1/approvals/sermons/{sermon_id}/publish", {
    params: { path: { sermon_id: id } },
  });
const rejectCall = (id: string, note: string) =>
  api.POST("/api/v1/approvals/sermons/{sermon_id}/reject", {
    params: { path: { sermon_id: id } },
    body: { note },
  });

async function runAction(vars: ReviewActionVars): Promise<void> {
  const id = vars.item.id;
  switch (vars.kind) {
    case "startReview":
      await startReview(id);
      return;
    case "takeOver":
      try {
        await takeOverCall(id);
      } catch (err) {
        // The caller already holds the claim — that's the state we wanted.
        // Anything else (422 not-under-review, 5xx, transport) propagates.
        if (!isAlreadyReviewingConflict(err)) throw err;
      }
      return;
    case "approve":
      await approveCall(id);
      return;
    case "publish":
      await publishCall(id);
      return;
    case "approvePublish": {
      // Two ordered calls — there is no combined route. The failure of each leg
      // is reported with its phase so `onError` can tell "nothing happened"
      // from "approved but not published".
      let approved = vars.item.status === "approved";
      if (!approved) {
        try {
          await approveCall(id);
          approved = true;
        } catch (err) {
          if (isAlreadyApprovedConflict(err)) {
            // A prior attempt's approve landed (its publish must have failed),
            // or a concurrent reviewer approved it. Don't dead-end on the 409 —
            // fall through and just publish.
            approved = true;
          } else {
            throw new ReviewActionError("approve", false, err);
          }
        }
      }
      try {
        await publishCall(id);
      } catch (err) {
        throw new ReviewActionError("publish", approved, err);
      }
      return;
    }
    case "reject": {
      const note = vars.note?.trim() ?? "";
      if (!note) {
        // Belt-and-braces: the screen already blocks this. Never send a
        // noteless rejection.
        throw new Error("A rejection needs a note.");
      }
      await rejectCall(id, note);
      return;
    }
    default:
      return assertNever(vars.kind);
  }
}

export interface UseReviewActionsOptions {
  /** The signed-in reviewer's display name — the optimistic `review_claimed_by`
      for "Start review" / "Take over review", shown as "Under review · <name>"
      on any other card. */
  meName: string | null;
  /** The signed-in reviewer's user id — the optimistic `review_claimed_by_id`
      for "Start review" / "Take over review". The card compares this against the
      session id to decide "· you" and whether the claim lock applies. */
  meId: string;
  /** A card's action failed with nothing committed (a plain failure, or the
      `approve` leg of `approve_and_publish`). `vars` identifies the card;
      render `message` as an `<Alert>` at the top of it. The screen keeps the
      card's `rejecting` mode + typed note, so a rejection rollback re-shows the
      textarea intact. */
  onError: (vars: ReviewActionVars, message: string) => void;
  /** `approve_and_publish` where the **approve committed** but `publish` then
      failed. The card must NOT go back to a pending badge. The row refetches as
      `approved` and stays in the queue (#12); the screen clears any half-open
      reject `mode` on that card (so it shows the "Publish" retry, not the
      reject textarea) and surfaces `detail` as a transient card-top alert.
      `detail` is the underlying publish error. */
  onApprovedNotPublished: (vars: ReviewActionVars, detail: string) => void;
  /** A card's action went through. The screen clears that card's local state. */
  onSuccess?: (vars: ReviewActionVars) => void;
  /** A `publish` went through — the two-step `approvePublish`, or a plain
      `publish` on an already-`approved` card. Fire the "Published to the app"
      toast. */
  onPublished?: (vars: ReviewActionVars) => void;
}

interface Context {
  snapshot: QueueSnapshot;
}

export function useReviewActions(options: UseReviewActionsOptions) {
  const qc = useQueryClient();

  // The set of card ids with a mutation in flight. `mutation.variables` only
  // ever holds the *most recent* call, so it can't gate two cards acted on in
  // quick succession — the first would re-enable and double-submit (→ 409).
  // Tracked per id: added in `onMutate`, removed in `onSettled`.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const mutation = useMutation<void, Error, ReviewActionVars, Context>({
    mutationFn: runAction,
    onMutate: async (vars) => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(vars.item.id);
        return next;
      });
      await qc.cancelQueries({ queryKey: queryKeys.review.queue() });
      const snapshot = currentQueues(qc);
      if (vars.kind === "startReview" || vars.kind === "takeOver") {
        // Claim paths: the card stays in the queue, now under_review + mine.
        claimInQueues(qc, vars.item.id, options.meName, options.meId);
      } else {
        // approve / approvePublish / publish / reject — the card leaves.
        removeFromQueues(qc, vars.item.id);
      }
      return { snapshot };
    },
    onError: (err, vars, context) => {
      if (err instanceof ReviewActionError && err.phase === "publish") {
        // The approve committed. Do NOT restore the pending badge — leave the
        // card removed (it's no longer pending), and for any page still showing
        // it (stale tab / race) make it read `approved`. The settle refetch
        // brings it back as an `approved` card (#12); the screen clears any
        // half-open reject mode and shows a transient card-top error there.
        markApprovedInQueues(qc, vars.item.id);
        options.onApprovedNotPublished(
          vars,
          messageFor(err.cause, `Publishing “${vars.item.title}” failed.`),
        );
        return;
      }
      // Plain failure, or the approve leg failed — nothing committed. Full
      // rollback + the generic message.
      if (context) restoreQueues(qc, context.snapshot);
      const cause = err instanceof ReviewActionError ? err.cause : err;
      options.onError(
        vars,
        messageFor(cause, `Couldn’t ${VERB[vars.kind]} “${vars.item.title}”.`),
      );
    },
    onSuccess: (_data, vars) => {
      if (vars.kind === "approvePublish" || vars.kind === "publish") {
        options.onPublished?.(vars);
      }
      options.onSuccess?.(vars);
    },
    onSettled: (_data, _err, vars) => {
      setPendingIds((prev) => {
        if (!prev.has(vars.item.id)) return prev;
        const next = new Set(prev);
        next.delete(vars.item.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: queryKeys.review.queue() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.counts() });
      qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
    },
  });

  return {
    /** True while a mutation for `id` is in flight — scopes "busy" to one card
        instead of freezing the whole list, and holds for every id acted on
        concurrently (not just the most recent). */
    isPending: (id: string) => pendingIds.has(id),
    startReview: (item: ReviewQueueItem) =>
      mutation.mutate({ kind: "startReview", item }),
    /** Reassign an in-progress review to me (`POST …/{id}/take-over-review`).
        Optimistically claims the card; a 409 (I already hold it) is a no-op
        success, a 422 (not under review) rolls back to a card-top alert. */
    takeOver: (item: ReviewQueueItem) =>
      mutation.mutate({ kind: "takeOver", item }),
    approve: (item: ReviewQueueItem) =>
      mutation.mutate({ kind: "approve", item }),
    /** Publish an already-`approved` card (`POST …/{id}/publish`). Not
        claim-gated — any manager. The card leaves the queue on success. */
    publish: (item: ReviewQueueItem) =>
      mutation.mutate({ kind: "publish", item }),
    approveAndPublish: (item: ReviewQueueItem) =>
      mutation.mutate({ kind: "approvePublish", item }),
    reject: (item: ReviewQueueItem, note: string) => {
      if (!note.trim()) return;
      mutation.mutate({ kind: "reject", item, note });
    },
  };
}

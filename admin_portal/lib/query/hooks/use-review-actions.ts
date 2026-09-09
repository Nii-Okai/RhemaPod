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
 *   watch           POST …/{id}/start-review                      status → under_review,
 *                                                                 review_claimed_by → me
 *                                                                 (card stays in the queue)
 *   approve         POST …/{id}/approve                           card leaves the queue
 *   approvePublish  POST …/{id}/approve → POST …/{id}/publish     card leaves the queue
 *   reject          POST …/{id}/reject  {note}                    card leaves the queue
 *
 * There is **no** combined "approve & publish" route — it is two ordered calls
 * (verified against `app/api/sermon_approval.py`). `publish` returns
 * `StatusResponse {id, status}` only — **no subscriber count** — so the success
 * toast is the bare "Published to the app" (gap noted for a later batch).
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
  | "watch"
  | "approve"
  | "approvePublish"
  | "reject";

export interface ReviewActionVars {
  kind: ReviewActionKind;
  item: ReviewQueueItem;
  /** Only for `reject` — the (already non-empty) rejection note. */
  note?: string;
}

const VERB: Record<ReviewActionKind, string> = {
  watch: "start review on",
  approve: "approve",
  approvePublish: "approve and publish",
  reject: "reject",
};

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

/** Mark `id` as claimed by `claimedBy` (the "Watch" optimistic patch). */
function claimInQueues(
  qc: QueryClient,
  id: string,
  claimedBy: string | null,
): void {
  for (const [key, data] of currentQueues(qc)) {
    if (!data) continue;
    qc.setQueryData<ReviewQueuePage>(key, {
      ...data,
      items: data.items.map((item) =>
        item.id === id
          ? { ...item, status: "under_review", review_claimed_by: claimedBy }
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
    case "watch":
      await startReview(id);
      return;
    case "approve":
      await approveCall(id);
      return;
    case "approvePublish":
      // Two ordered calls — there is no combined route. If `approve` throws,
      // `publish` never runs and the whole mutation rejects → rollback.
      await approveCall(id);
      await publishCall(id);
      return;
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
  }
}

export interface UseReviewActionsOptions {
  /** The signed-in reviewer's display name — the optimistic `review_claimed_by`
      for "Watch", and what the screen compares for "· you". */
  meName: string | null;
  /** A card's action failed. `vars` identifies the card; render `message` as an
      `<Alert>` at the top of it. The screen keeps the card's `rejecting` mode +
      typed note, so a rejection rollback re-shows the textarea intact. */
  onError: (vars: ReviewActionVars, message: string) => void;
  /** A card's action went through. The screen clears that card's local state. */
  onSuccess?: (vars: ReviewActionVars) => void;
  /** `approvePublish` reached `publish`. Fire the "Published to the app" toast. */
  onPublished?: (vars: ReviewActionVars) => void;
}

interface Context {
  snapshot: QueueSnapshot;
}

export function useReviewActions(options: UseReviewActionsOptions) {
  const qc = useQueryClient();

  const mutation = useMutation<void, Error, ReviewActionVars, Context>({
    mutationFn: runAction,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: queryKeys.review.queue() });
      const snapshot = currentQueues(qc);
      if (vars.kind === "watch") {
        claimInQueues(qc, vars.item.id, options.meName);
      } else {
        removeFromQueues(qc, vars.item.id);
      }
      return { snapshot };
    },
    onError: (err, vars, context) => {
      if (context) restoreQueues(qc, context.snapshot);
      options.onError(
        vars,
        messageFor(err, `Couldn’t ${VERB[vars.kind]} “${vars.item.title}”.`),
      );
    },
    onSuccess: (_data, vars) => {
      if (vars.kind === "approvePublish") options.onPublished?.(vars);
      options.onSuccess?.(vars);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.review.queue() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.counts() });
      qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
    },
  });

  return {
    isPending: mutation.isPending,
    /** The card id currently mutating, or null — so the screen can scope
        "busy" to one card instead of freezing the whole list. */
    pendingId: mutation.isPending
      ? (mutation.variables?.item.id ?? null)
      : null,
    watch: (item: ReviewQueueItem) => mutation.mutate({ kind: "watch", item }),
    approve: (item: ReviewQueueItem) =>
      mutation.mutate({ kind: "approve", item }),
    approveAndPublish: (item: ReviewQueueItem) =>
      mutation.mutate({ kind: "approvePublish", item }),
    reject: (item: ReviewQueueItem, note: string) => {
      if (!note.trim()) return;
      mutation.mutate({ kind: "reject", item, note });
    },
  };
}

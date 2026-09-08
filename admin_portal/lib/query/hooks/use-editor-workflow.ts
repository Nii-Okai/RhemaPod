/**
 * `useEditorWorkflow` — Submit-for-review and Withdraw from *inside* the editor
 * (W8). A thin editor-local sibling of the Sermons-list `useSermonWorkflow`,
 * matching its shape (an `onError(message)` string callback the screen renders
 * as a card `<Alert>`, never a toast — design "Errors").
 *
 *  - **Submit** (`POST /sermons/{id}/submit`) is optimistic: the caller flips
 *    the status badge to `pending_review` via `onOptimistic`, and on failure
 *    `onRollback` restores it (plan §A.4 — submit is in the optimistic set).
 *  - **Withdraw** (`POST /sermons/{id}/withdraw`) is **not** optimistic. An
 *    editor withdrawing from `under_review` now gets a **409** with the message
 *    "A manager is reviewing this — ask them to send it back." (GATE 3 Batch 2);
 *    nothing changed optimistically, so the 409 just surfaces as the card alert
 *    with no rollback.
 *
 * Both invalidate the list, counts, this sermon's detail + approval log and the
 * review queue on settle, so every other surface reconciles.
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import type { SermonStatus } from "@/components/sermons/sermon-status";

type Action = "submit" | "withdraw";

export interface UseEditorWorkflowOptions {
  sermonId: string | undefined;
  /** Optimistically move the badge (submit only). */
  onOptimistic: (status: SermonStatus) => void;
  /** Undo the optimistic move (submit failure only). */
  onRollback: () => void;
  /** Settled truth from the server — clear any optimistic override. */
  onSettledStatus: (status: SermonStatus) => void;
  /** Render this atop the card as an `<Alert>`. */
  onError: (message: string) => void;
}

function messageFor(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return fallback;
}

export function useEditorWorkflow(options: UseEditorWorkflowOptions) {
  const qc = useQueryClient();
  const { sermonId } = options;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
    qc.invalidateQueries({ queryKey: queryKeys.sermons.counts() });
    qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
    qc.invalidateQueries({ queryKey: queryKeys.review.queue() });
    if (sermonId) {
      qc.invalidateQueries({ queryKey: queryKeys.sermons.detail(sermonId) });
      qc.invalidateQueries({
        queryKey: queryKeys.sermons.approvalLog(sermonId),
      });
    }
  };

  const mutation = useMutation<
    { status: SermonStatus },
    Error,
    Action
  >({
    mutationFn: async (action) => {
      if (!sermonId) throw new Error("This draft hasn’t been saved yet.");
      const path =
        action === "submit"
          ? ("/api/v1/sermons/{sermon_id}/submit" as const)
          : ("/api/v1/sermons/{sermon_id}/withdraw" as const);
      const { data } = await api.POST(path, {
        params: { path: { sermon_id: sermonId } },
      });
      // `/submit` and `/withdraw` both return `StatusResponse {id, status}`, so
      // the server's own status is authoritative. `data` is only ever missing
      // on a non-2xx, which `throwOnError` has already rejected — so this
      // fallback is defensive, and it targets the action's OWN outcome, never a
      // blanket "draft" that would wipe an optimistic Pending-review badge on a
      // *successful* submit.
      const fallback: SermonStatus =
        action === "submit" ? "pending_review" : "draft";
      return { status: (data?.status ?? fallback) as SermonStatus };
    },
    onMutate: (action) => {
      if (action === "submit") options.onOptimistic("pending_review");
    },
    onError: (err, action) => {
      if (action === "submit") options.onRollback();
      options.onError(
        messageFor(
          err,
          action === "submit"
            ? "Couldn’t submit this sermon for review."
            : "Couldn’t withdraw this sermon.",
        ),
      );
    },
    onSuccess: ({ status }) => {
      options.onSettledStatus(status);
    },
    onSettled: invalidate,
  });

  return {
    isPending: mutation.isPending,
    submit: () => mutation.mutate("submit"),
    withdraw: () => mutation.mutate("withdraw"),
  };
}

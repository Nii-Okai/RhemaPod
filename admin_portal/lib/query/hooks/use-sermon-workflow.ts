/**
 * `useSermonWorkflow` — the Sermons-list row-menu + bulk-bar mutations (W7).
 *
 * Optimistic status transitions with rollback (plan §A.4): `onMutate` snapshots
 * every `sermons.list*` cache and patches the affected rows locally; a failure
 * (network, or a partial failure inside a batch) restores the snapshot;
 * `onSettled` invalidates `sermons.lists()`, `sermons.details()` and
 * `review.queue()` so the screen reconciles against the server.
 *
 * Every action is a batch of one-or-more ids run with `Promise.allSettled`, so
 * a bulk "Submit for review" over five rows is one optimistic pass, one
 * settle, and — on partial failure — one `<Alert>` naming exactly which rows
 * did not go through (never a toast; design "Errors").
 *
 *   kind      endpoint                                    optimistic → status
 *   ────      ────────                                    ───────────────────
 *   submit    POST /sermons/{id}/submit                   pending_review
 *   resubmit  POST /sermons/{id}/submit  (same route)     pending_review
 *   unpublish POST /approvals/sermons/{id}/unpublish      unpublished
 *   publish   POST /approvals/sermons/{id}/publish        published
 *   delete    DELETE /sermons/{id}                        (row removed)
 *
 * "Withdraw" is absent by design — it has no backend transition (see
 * `row-menu-items.ts`, [GATE 3 Batch 2]).
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
import type { SermonListPage } from "@/lib/query/hooks/use-sermons";
import type { SermonStatus } from "@/components/sermons/sermon-status";

export type WorkflowKind =
  | "submit"
  | "resubmit"
  | "unpublish"
  | "publish"
  | "delete";

export interface WorkflowRow {
  id: string;
  title: string;
}

const ENDPOINT: Record<WorkflowKind, (id: string) => Promise<unknown>> = {
  submit: (id) =>
    api.POST("/api/v1/sermons/{sermon_id}/submit", {
      params: { path: { sermon_id: id } },
    }),
  resubmit: (id) =>
    api.POST("/api/v1/sermons/{sermon_id}/submit", {
      params: { path: { sermon_id: id } },
    }),
  unpublish: (id) =>
    api.POST("/api/v1/approvals/sermons/{sermon_id}/unpublish", {
      params: { path: { sermon_id: id } },
    }),
  publish: (id) =>
    api.POST("/api/v1/approvals/sermons/{sermon_id}/publish", {
      params: { path: { sermon_id: id } },
    }),
  delete: (id) =>
    api.DELETE("/api/v1/sermons/{sermon_id}", {
      params: { path: { sermon_id: id } },
    }),
};

const NEXT_STATUS: Partial<Record<WorkflowKind, SermonStatus>> = {
  submit: "pending_review",
  resubmit: "pending_review",
  unpublish: "unpublished",
  publish: "published",
};

const VERB: Record<WorkflowKind, string> = {
  submit: "submit",
  resubmit: "resubmit",
  unpublish: "unpublish",
  publish: "publish",
  delete: "delete",
};

type ListSnapshot = Array<
  [readonly unknown[], SermonListPage | undefined]
>;

function snapshotLists(qc: QueryClient): ListSnapshot {
  return qc.getQueriesData<SermonListPage>({
    queryKey: queryKeys.sermons.lists(),
  }) as ListSnapshot;
}

function restoreLists(qc: QueryClient, snapshot: ListSnapshot): void {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

function patchStatus(
  qc: QueryClient,
  ids: Set<string>,
  status: SermonStatus,
): void {
  for (const [key, data] of snapshotLists(qc)) {
    if (!data) continue;
    qc.setQueryData<SermonListPage>(key, {
      ...data,
      items: data.items.map((item) =>
        ids.has(item.id) ? { ...item, status } : item,
      ),
    });
  }
}

function removeRows(qc: QueryClient, ids: Set<string>): void {
  for (const [key, data] of snapshotLists(qc)) {
    if (!data) continue;
    const removed = data.items.filter((item) => ids.has(item.id)).length;
    qc.setQueryData<SermonListPage>(key, {
      ...data,
      items: data.items.filter((item) => !ids.has(item.id)),
      total: Math.max(0, data.total - removed),
    });
  }
}

function messageFor(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (ref ${err.correlationId})`
      : err.detail;
  }
  return fallback;
}

function failureLine(kind: WorkflowKind, failed: WorkflowRow[]): string {
  const names = failed.map((row) => `“${row.title}”`).join(", ");
  return failed.length === 1
    ? `Couldn’t ${VERB[kind]} ${names}.`
    : `Couldn’t ${VERB[kind]} ${failed.length} sermons: ${names}.`;
}

export interface UseSermonWorkflowOptions {
  /** Surface a failure. The screen renders it as an `<Alert>` atop the table
      card — never a toast (design "Errors"). */
  onError: (message: string) => void;
  /** Every id in the batch succeeded. The screen clears its selection here. */
  onSuccess?: (kind: WorkflowKind, rows: WorkflowRow[]) => void;
}

interface Variables {
  kind: WorkflowKind;
  rows: WorkflowRow[];
}
interface Context {
  snapshot: ListSnapshot;
}
interface Outcome {
  failed: WorkflowRow[];
}

export function useSermonWorkflow(options: UseSermonWorkflowOptions) {
  const qc = useQueryClient();

  const mutation = useMutation<Outcome, Error, Variables, Context>({
    mutationFn: async ({ kind, rows }) => {
      const settled = await Promise.allSettled(
        rows.map((row) => ENDPOINT[kind](row.id)),
      );
      const failed = rows.filter(
        (_, index) => settled[index].status === "rejected",
      );
      return { failed };
    },
    onMutate: async ({ kind, rows }) => {
      await qc.cancelQueries({ queryKey: queryKeys.sermons.lists() });
      const snapshot = snapshotLists(qc);
      const ids = new Set(rows.map((row) => row.id));
      if (kind === "delete") removeRows(qc, ids);
      else {
        const next = NEXT_STATUS[kind];
        if (next) patchStatus(qc, ids, next);
      }
      return { snapshot };
    },
    onError: (err, { kind }, context) => {
      if (context) restoreLists(qc, context.snapshot);
      options.onError(messageFor(err, `Couldn’t ${VERB[kind]} that sermon.`));
    },
    onSuccess: ({ failed }, { kind, rows }, context) => {
      if (failed.length === 0) {
        options.onSuccess?.(kind, rows);
        return;
      }
      // Partial failure: roll the optimistic patch all the way back and let
      // `onSettled`'s invalidate pull the real state (the rows that DID go
      // through will come back changed). Then name the ones that failed.
      if (context) restoreLists(qc, context.snapshot);
      options.onError(failureLine(kind, failed));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.details() });
      qc.invalidateQueries({ queryKey: queryKeys.review.queue() });
    },
  });

  const run = (kind: WorkflowKind, rows: WorkflowRow[]) => {
    if (rows.length === 0) return;
    mutation.mutate({ kind, rows });
  };

  return {
    isPending: mutation.isPending,
    submit: (rows: WorkflowRow[]) => run("submit", rows),
    resubmit: (rows: WorkflowRow[]) => run("resubmit", rows),
    unpublish: (rows: WorkflowRow[]) => run("unpublish", rows),
    publish: (rows: WorkflowRow[]) => run("publish", rows),
    remove: (rows: WorkflowRow[]) => run("delete", rows),
  };
}

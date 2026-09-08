/**
 * `useSermonWorkflow` — the Sermons-list row-menu + bulk-bar mutations (W7).
 *
 * Optimistic status transitions with rollback (plan §A.4): `onMutate` snapshots
 * every `sermons.list*` cache and patches the affected rows locally; `onSettled`
 * invalidates `sermons.lists()`, `sermons.details()`, `sermons.counts()`,
 * `review.queue()` and `nav.counts()` so the screen — and the header count line
 * and sidebar pills — reconcile against the server.
 *
 * Each action is a batch of one-or-more ids run with `Promise.allSettled`.
 * Failure routing:
 *
 *   - **Every row failed** → `mutationFn` throws a `WorkflowError`, so the
 *     mutation rejects and `onError` runs: it restores the pre-mutation
 *     snapshot wholesale and messages the failure through `messageFor()` so the
 *     backend `detail` and the `correlationId` support ref survive.
 *   - **Partial failure** (some rows went through) → resolves via `onSuccess`,
 *     which reconciles **per row**: restore the snapshot, then re-apply the
 *     optimistic change for the succeeded ids only, leaving the failed ids at
 *     their real pre-mutation state (no rollback flash on the rows that worked).
 *
 * On any failure the screen renders one `<Alert>` atop the table card — never a
 * toast (design "Errors").
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

/** A row whose endpoint call rejected, carrying the rejection (an `ApiError`
    on any response the backend produced). */
export interface FailedRow extends WorkflowRow {
  error: unknown;
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

/** Thrown by `mutationFn` when *every* row in the batch failed, so a total
    outage rejects the mutation (→ `onError`) while partials resolve (→
    `onSuccess`). Carries the per-row rejections for messaging. */
class WorkflowError extends Error {
  readonly kind: WorkflowKind;
  readonly failed: FailedRow[];
  constructor(kind: WorkflowKind, failed: FailedRow[]) {
    super(`Every ${kind} in the batch failed`);
    this.name = "WorkflowError";
    this.kind = kind;
    this.failed = failed;
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

type ListSnapshot = Array<
  [readonly unknown[], SermonListPage | undefined]
>;

/** Enumerate the live `sermons.list*` caches. Used both to take the rollback
    snapshot in `onMutate` and to walk the caches while patching — the name
    stays neutral so a read here doesn't read as "restoring from a snapshot". */
function currentLists(qc: QueryClient): ListSnapshot {
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
  for (const [key, data] of currentLists(qc)) {
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
  for (const [key, data] of currentLists(qc)) {
    if (!data) continue;
    const removed = data.items.filter((item) => ids.has(item.id)).length;
    qc.setQueryData<SermonListPage>(key, {
      ...data,
      items: data.items.filter((item) => !ids.has(item.id)),
      total: Math.max(0, data.total - removed),
    });
  }
}

/** Apply the optimistic change for a set of ids (empty set is a no-op). */
function applyOptimistic(
  qc: QueryClient,
  kind: WorkflowKind,
  ids: Set<string>,
): void {
  if (ids.size === 0) return;
  if (kind === "delete") {
    removeRows(qc, ids);
    return;
  }
  const next = NEXT_STATUS[kind];
  if (next) patchStatus(qc, ids, next);
}

/** `detail` + a "(reference: <cid>)" affordance from an `ApiError`; the
    fallback for anything that never reached the backend. */
function messageFor(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return fallback;
}

function failureLine(kind: WorkflowKind, failed: Array<{ title: string }>): string {
  const names = failed.map((row) => `“${row.title}”`).join(", ");
  return failed.length === 1
    ? `Couldn’t ${VERB[kind]} ${names}.`
    : `Couldn’t ${VERB[kind]} ${failed.length} sermons: ${names}.`;
}

/**
 * One `<Alert>` string for a failed (total or partial) batch.
 *   - single row  → the "Couldn't … "Title"." line PLUS the backend `detail`
 *     and a `(reference: <cid>)` affordance from `messageFor`.
 *   - multi row   → the "Couldn't … N sermons: …" line; if every failure is an
 *     `ApiError` sharing one `detail`, show it once; always surface one
 *     `correlationId` if any failure carries one.
 */
function composeFailureMessage(kind: WorkflowKind, failed: FailedRow[]): string {
  if (failed.length === 1) {
    const backend = messageFor(failed[0].error, "");
    const line = failureLine(kind, failed);
    return backend ? `${line} ${backend}` : line;
  }

  let line = failureLine(kind, failed);
  const apiErrors = failed
    .map((row) => row.error)
    .filter(isApiError);

  const details = new Set(apiErrors.map((err) => err.detail));
  if (apiErrors.length === failed.length && details.size === 1) {
    line += ` ${[...details][0]}`;
  }

  const correlationId = apiErrors.find((err) => err.correlationId)?.correlationId;
  if (correlationId) line += ` (reference: ${correlationId})`;

  return line;
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
  succeeded: WorkflowRow[];
  failed: FailedRow[];
}

export function useSermonWorkflow(options: UseSermonWorkflowOptions) {
  const qc = useQueryClient();

  const mutation = useMutation<Outcome, Error, Variables, Context>({
    mutationFn: async ({ kind, rows }) => {
      const settled = await Promise.allSettled(
        rows.map((row) => ENDPOINT[kind](row.id)),
      );
      const succeeded: WorkflowRow[] = [];
      const failed: FailedRow[] = [];
      rows.forEach((row, index) => {
        const result = settled[index];
        if (result.status === "rejected") {
          failed.push({ ...row, error: result.reason });
        } else {
          succeeded.push(row);
        }
      });

      // Total failure → reject so `onError` (not `onSuccess`) handles it and
      // the backend detail + correlation ref reach the alert.
      if (succeeded.length === 0 && failed.length > 0) {
        throw new WorkflowError(kind, failed);
      }
      return { succeeded, failed };
    },
    onMutate: async ({ kind, rows }) => {
      await qc.cancelQueries({ queryKey: queryKeys.sermons.lists() });
      const snapshot = currentLists(qc);
      applyOptimistic(qc, kind, new Set(rows.map((row) => row.id)));
      return { snapshot };
    },
    onError: (err, { kind }, context) => {
      if (context) restoreLists(qc, context.snapshot);
      options.onError(
        err instanceof WorkflowError
          ? composeFailureMessage(err.kind, err.failed)
          : messageFor(err, `Couldn’t ${VERB[kind]} that sermon.`),
      );
    },
    onSuccess: ({ succeeded, failed }, { kind, rows }, context) => {
      if (failed.length === 0) {
        options.onSuccess?.(kind, rows);
        return;
      }
      // Partial failure. Reconcile per row: restore the pre-mutation snapshot,
      // then re-apply the optimistic change for the succeeded ids only. Failed
      // ids stay at their real (pre-mutation) state — no rollback flash on the
      // rows that actually went through. `onSettled` then refetches the truth.
      if (context) restoreLists(qc, context.snapshot);
      applyOptimistic(qc, kind, new Set(succeeded.map((row) => row.id)));
      options.onError(composeFailureMessage(kind, failed));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.details() });
      qc.invalidateQueries({ queryKey: queryKeys.sermons.counts() });
      qc.invalidateQueries({ queryKey: queryKeys.review.queue() });
      qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
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

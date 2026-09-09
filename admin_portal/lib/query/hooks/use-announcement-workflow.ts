/**
 * `useAnnouncementWorkflow` — the Announcements-list `···` row-menu mutations
 * (W13). The list's row menu is the single manager surface for announcement
 * approvals (there is no separate announcement review-queue screen), so every
 * transition the design's matrix offers is wired here:
 *
 *   kind       wire                                                     role
 *   ────       ────                                                     ────
 *   submit     POST /api/v1/announcements/{id}/submit                   editor+
 *   approve    POST /api/v1/approvals/announcements/{id}/approve        manager+
 *   reject     POST /api/v1/approvals/announcements/{id}/reject {note}  manager+
 *   publish    POST /api/v1/approvals/announcements/{id}/publish        manager+
 *   unpublish  POST /api/v1/approvals/announcements/{id}/unpublish      manager+
 *   archive    POST /api/v1/approvals/announcements/{id}/archive        manager+
 *   delete     DELETE /api/v1/announcements/{id}                        editor+ (own draft/rejected)
 *
 * Status transitions are NOT optimistic — the W10 review-actions precedent:
 * show the server's result, don't flip a badge on a guess and risk a rollback
 * lie. (The optimistic case, per the plan, is the pin toggle — a PATCH — which
 * lives in `useUpdateAnnouncement`.) Failures are surfaced through an
 * `onError(vars, message)` string callback the screen renders as an `<Alert>`
 * at the top of the table card, never a toast (design §"Errors").
 *
 * `isPending(id)` scopes "busy" to the row being acted on (tracked in a Set,
 * added in `onMutate`, removed in `onSettled`) so acting on a second row in
 * quick succession can't double-submit the first. Every settle invalidates
 * `announcements.lists()`.
 */

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import type { AnnouncementAdminItem } from "@/lib/query/hooks/use-announcements";

export type AnnouncementWorkflowKind =
  | "submit"
  | "approve"
  | "reject"
  | "publish"
  | "unpublish"
  | "archive"
  | "delete";

export interface AnnouncementWorkflowVars {
  kind: AnnouncementWorkflowKind;
  item: AnnouncementAdminItem;
  /** Only for `reject` — the (optional) note for the editor. */
  note?: string;
}

const VERB: Record<AnnouncementWorkflowKind, string> = {
  submit: "submit",
  approve: "approve",
  reject: "reject",
  publish: "publish",
  unpublish: "unpublish",
  archive: "archive",
  delete: "delete",
};

/** The three ManagerPlus approval transitions that take no body and just move
    the status. `submit`, `reject` and `delete` differ (route, body, verb) and
    are handled inline. */
async function approvalTransition(
  id: string,
  kind: "approve" | "publish" | "unpublish" | "archive",
): Promise<void> {
  const path = { announcement_id: id };
  if (kind === "approve") {
    await api.POST("/api/v1/approvals/announcements/{announcement_id}/approve", {
      params: { path },
    });
  } else if (kind === "publish") {
    await api.POST("/api/v1/approvals/announcements/{announcement_id}/publish", {
      params: { path },
    });
  } else if (kind === "unpublish") {
    await api.POST(
      "/api/v1/approvals/announcements/{announcement_id}/unpublish",
      { params: { path } },
    );
  } else {
    await api.POST("/api/v1/approvals/announcements/{announcement_id}/archive", {
      params: { path },
    });
  }
}

async function runAction(vars: AnnouncementWorkflowVars): Promise<void> {
  const id = vars.item.id;
  switch (vars.kind) {
    case "submit":
      await api.POST("/api/v1/announcements/{announcement_id}/submit", {
        params: { path: { announcement_id: id } },
      });
      return;
    case "reject": {
      const note = vars.note?.trim();
      await api.POST("/api/v1/approvals/announcements/{announcement_id}/reject", {
        params: { path: { announcement_id: id } },
        body: { note: note && note.length > 0 ? note : null },
      });
      return;
    }
    case "delete":
      await api.DELETE("/api/v1/announcements/{announcement_id}", {
        params: { path: { announcement_id: id } },
      });
      return;
    default:
      await approvalTransition(id, vars.kind);
      return;
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

export interface UseAnnouncementWorkflowOptions {
  /** A row action failed. `vars` identifies the row; render `message` as an
      `<Alert>` at the top of the table card. */
  onError: (vars: AnnouncementWorkflowVars, message: string) => void;
  /** A row action went through. The screen clears any per-row local state. */
  onSuccess?: (vars: AnnouncementWorkflowVars) => void;
}

export function useAnnouncementWorkflow(options: UseAnnouncementWorkflowOptions) {
  const qc = useQueryClient();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const mutation = useMutation<void, Error, AnnouncementWorkflowVars>({
    mutationFn: runAction,
    onMutate: (vars) => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(vars.item.id);
        return next;
      });
    },
    onError: (err, vars) => {
      options.onError(
        vars,
        messageFor(err, `Couldn’t ${VERB[vars.kind]} “${vars.item.title}”.`),
      );
    },
    onSuccess: (_data, vars) => {
      options.onSuccess?.(vars);
    },
    onSettled: (_data, _err, vars) => {
      setPendingIds((prev) => {
        if (!prev.has(vars.item.id)) return prev;
        const next = new Set(prev);
        next.delete(vars.item.id);
        return next;
      });
      void qc.invalidateQueries({ queryKey: queryKeys.announcements.lists() });
    },
  });

  const fire = (kind: AnnouncementWorkflowKind, item: AnnouncementAdminItem) =>
    mutation.mutate({ kind, item });

  return {
    isPending: (id: string) => pendingIds.has(id),
    submit: (item: AnnouncementAdminItem) => fire("submit", item),
    approve: (item: AnnouncementAdminItem) => fire("approve", item),
    publish: (item: AnnouncementAdminItem) => fire("publish", item),
    unpublish: (item: AnnouncementAdminItem) => fire("unpublish", item),
    archive: (item: AnnouncementAdminItem) => fire("archive", item),
    remove: (item: AnnouncementAdminItem) => fire("delete", item),
    reject: (item: AnnouncementAdminItem, note: string) =>
      mutation.mutate({ kind: "reject", item, note }),
  };
}

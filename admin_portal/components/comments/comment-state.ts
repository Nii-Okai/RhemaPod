/* =============================================================================
   Comment state + role helpers (S12). Pure, unit-tested without a DOM.

   The role helpers are COSMETIC: they decide which actions the UI offers. The
   server is the authority and every action still handles a 403 (stale gate).
   ========================================================================== */

import type { AdminCommentRow } from "@/lib/query/hooks/use-admin-comments";

export type CommentState = "visible" | "reported" | "auto_hidden" | "hidden";

export const COMMENT_STATE_LABEL: Record<CommentState, string> = {
  visible: "Visible",
  reported: "Reported",
  auto_hidden: "Auto-hidden",
  hidden: "Hidden",
};

export function commentStateOf(
  row: Pick<AdminCommentRow, "status" | "hidden_auto" | "report_count">,
): CommentState {
  if (row.status === "HIDDEN") return row.hidden_auto ? "auto_hidden" : "hidden";
  return row.report_count > 0 ? "reported" : "visible";
}

/** Hide / restore / dismiss reports: MANAGER and ADMIN. */
export function canModerate(role: string): boolean {
  return role === "manager" || role === "admin";
}

/** Hard delete: ADMIN only. */
export function canDelete(role: string): boolean {
  return role === "admin";
}

export type CommentAction = "hide" | "restore" | "dismiss" | "delete";

/** The actions a role is offered on a row. Absent, never disabled. */
export function availableActions(
  row: Pick<AdminCommentRow, "status" | "report_count">,
  role: string,
): CommentAction[] {
  const actions: CommentAction[] = [];
  if (canModerate(role)) {
    if (row.status === "HIDDEN") actions.push("restore");
    else {
      actions.push("hide");
      if (row.report_count > 0) actions.push("dismiss");
    }
  }
  if (canDelete(role)) actions.push("delete");
  return actions;
}

export const ACTION_LABEL: Record<CommentAction, string> = {
  hide: "Hide",
  restore: "Restore",
  dismiss: "Dismiss reports",
  delete: "Delete permanently",
};

/** Absolute timestamp for `title` / the drawer. Falls back to the raw string. */
export function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short relative time ("5m ago", "3d ago"); older than 30 days → a date. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d <= 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

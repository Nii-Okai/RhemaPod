/**
 * Comments moderation queue — list + mutation hooks (S12).
 *
 *   useAdminComments({ status, sermonId, sort, page })
 *     GET /api/v1/admin/comments → Page[CommentAdmin] (MANAGER, ADMIN) or
 *                                  Page[CommentAdminForEditor] (EDITOR)
 *   useCommentCounts(sermonId)
 *     three `limit=1` probes of the same endpoint, read as `total` (no count
 *     endpoint exists — S2-Q5 / Conductor pin)
 *   useCommentModeration()
 *     hide / restore / dismiss-reports / hard-delete
 *
 * Role gating in the UI is cosmetic. The server is the authority, so the
 * mutations surface 403 / 404 / 409 to the caller as an `ApiError` and every
 * settle (success or failure) invalidates the whole `comments` domain and the
 * nav counts: a 404/409 means the row changed under us, so the list must be
 * refetched either way.
 */

"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { clampPage } from "@/lib/format";
import { queryKeys } from "@/lib/query/keys";

export type CommentAdmin = components["schemas"]["CommentAdmin"];
export type CommentAdminForEditor =
  components["schemas"]["CommentAdminForEditor"];
/** A queue row: MANAGER/ADMIN get `CommentAdmin`, an EDITOR gets the variant
    without `author_email`, `author_id` or `hidden_by_id`. */
export type AdminCommentRow = CommentAdmin | CommentAdminForEditor;
export type AdminCommentPage = {
  items: AdminCommentRow[];
  total: number;
  limit: number;
  offset: number;
};

/** Matches the endpoint's `limit` default. */
export const COMMENTS_PAGE_SIZE = 25;

/** Server cap on a moderation reason. */
export const REASON_MAX = 300;

export type CommentSort = "recent" | "most_reported";
/** The queue's status segments: Reported → `reported_only=true`, Hidden →
    `status=HIDDEN`, All → neither. */
export type CommentView = "reported" | "hidden" | "all";

export function toCommentView(raw: string | null | undefined): CommentView {
  return raw === "hidden" || raw === "all" ? raw : "reported";
}

export function toCommentSort(raw: string | null | undefined): CommentSort {
  return raw === "recent" ? "recent" : "most_reported";
}

/** The email is present only on the MANAGER/ADMIN shape. */
export function authorEmailOf(row: AdminCommentRow): string | null {
  return "author_email" in row ? row.author_email : null;
}

export interface LoadAdminCommentsParams {
  view: CommentView;
  sermonId?: string;
  sort: CommentSort;
  page: number;
}

export async function loadAdminComments(
  { view, sermonId, sort, page }: LoadAdminCommentsParams,
  client: ApiClient = api,
): Promise<AdminCommentPage> {
  const safePage = clampPage(page);
  const data = await unwrap(
    client.GET("/api/v1/admin/comments", {
      params: {
        query: {
          ...(view === "reported" ? { reported_only: true } : {}),
          ...(view === "hidden" ? { status: "HIDDEN" as const } : {}),
          ...(sermonId ? { sermon_id: sermonId } : {}),
          sort,
          limit: COMMENTS_PAGE_SIZE,
          offset: (safePage - 1) * COMMENTS_PAGE_SIZE,
        },
      },
    }),
  );
  return data as AdminCommentPage;
}

export function useAdminComments(params: LoadAdminCommentsParams) {
  const requestedPage = clampPage(params.page);
  const query = useQuery({
    queryKey: queryKeys.comments.list({
      ...(params.view === "reported" ? { reported_only: true } : {}),
      ...(params.view === "hidden" ? { status: "HIDDEN" as const } : {}),
      ...(params.sermonId ? { sermon_id: params.sermonId } : {}),
      sort: params.sort,
      limit: COMMENTS_PAGE_SIZE,
      offset: (requestedPage - 1) * COMMENTS_PAGE_SIZE,
    }),
    queryFn: () => loadAdminComments({ ...params, page: requestedPage }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / COMMENTS_PAGE_SIZE));
  return {
    items: query.data?.items ?? [],
    total,
    page: Math.min(requestedPage, pageCount),
    pageCount,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export interface CommentCounts {
  total: number;
  reported: number;
  hidden: number;
}

/** Editor-card counts: the `total` of three `limit=1` list probes. */
export async function loadCommentCounts(
  sermonId: string,
  client: ApiClient = api,
): Promise<CommentCounts> {
  const probe = async (
    extra: { reported_only?: boolean; status?: "HIDDEN" },
  ): Promise<number> => {
    const { data } = await client.GET("/api/v1/admin/comments", {
      params: { query: { sermon_id: sermonId, limit: 1, ...extra } },
    });
    return data?.total ?? 0;
  };
  const [total, reported, hidden] = await Promise.all([
    probe({}),
    probe({ reported_only: true }),
    probe({ status: "HIDDEN" }),
  ]);
  return { total, reported, hidden };
}

export function useCommentCounts(sermonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.comments.sermonCounts(sermonId ?? ""),
    queryFn: () => loadCommentCounts(sermonId as string),
    enabled: Boolean(sermonId),
    staleTime: 30_000,
  });
}

export type ModerationAction = "hide" | "restore" | "dismiss" | "delete";

export interface ModerationVars {
  id: string;
  /** Required for hide / dismiss / delete; ignored for restore. */
  reason?: string;
}

export function useCommentModeration() {
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.comments.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.nav.all() }),
    ]);

  const common = { onSettled: refresh };

  const hide = useMutation({
    ...common,
    mutationFn: ({ id, reason }: ModerationVars) =>
      unwrap(
        api.POST("/api/v1/admin/comments/{comment_id}/hide", {
          params: { path: { comment_id: id } },
          body: { reason: reason ?? "" },
        }),
      ),
  });

  const restore = useMutation({
    ...common,
    mutationFn: ({ id }: ModerationVars) =>
      unwrap(
        api.POST("/api/v1/admin/comments/{comment_id}/restore", {
          params: { path: { comment_id: id } },
        }),
      ),
  });

  const dismiss = useMutation({
    ...common,
    mutationFn: ({ id, reason }: ModerationVars) =>
      unwrap(
        api.POST("/api/v1/admin/comments/{comment_id}/dismiss-reports", {
          params: { path: { comment_id: id } },
          body: { reason: reason ?? "" },
        }),
      ),
  });

  const hardDelete = useMutation({
    ...common,
    mutationFn: async ({ id, reason }: ModerationVars) => {
      await api.DELETE("/api/v1/admin/comments/{comment_id}", {
        params: { path: { comment_id: id } },
        body: { reason: reason ?? "" },
      });
    },
  });

  return { hide, restore, dismiss, hardDelete };
}

/**
 * The dialog / banner copy for a failed moderation call. The cosmetic role gate
 * can be stale (403), the row can be gone (404) or in the wrong state (409).
 * Anything else is the generic retry line.
 */
export function moderationErrorMessage(
  err: unknown,
  action: ModerationAction,
): string {
  if (isApiError(err)) {
    if (err.status === 403) return "You don’t have permission to do this.";
    if (err.status === 404) return "This comment no longer exists.";
    if (err.status === 409) {
      return action === "dismiss"
        ? "This comment is hidden, so its reports can’t be dismissed. Restore it instead."
        : "This comment changed since you loaded it. The list has been refreshed.";
    }
  }
  return "Couldn’t complete the action. Try again.";
}

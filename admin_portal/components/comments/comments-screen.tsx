"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CommentDetailDialog } from "@/components/comments/comment-detail-dialog";
import { CommentReasonDialog } from "@/components/comments/comment-reason-dialog";
import { CommentStateChip } from "@/components/comments/comment-state-chip";
import {
  ACTION_LABEL,
  availableActions,
  commentStateOf,
  formatAbsolute,
  formatRelative,
  type CommentAction,
} from "@/components/comments/comment-state";
import { PageHeader } from "@/components/portal";
import { Avatar } from "@/components/portal/avatar";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { SegmentedControl } from "@/components/portal/segmented-control";
import { Toast } from "@/components/portal/toast";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { useSession } from "@/lib/auth/session-context";
import { clampPage } from "@/lib/format";
import {
  authorEmailOf,
  COMMENTS_PAGE_SIZE,
  moderationErrorMessage,
  toCommentSort,
  toCommentView,
  useAdminComments,
  useCommentModeration,
  type AdminCommentRow,
  type CommentSort,
  type CommentView,
} from "@/lib/query/hooks/use-admin-comments";

/* =============================================================================
   CommentsScreen — the moderation queue (S12; design comments-queue.md).

   URL is the state: `?status=reported|hidden|all`, `?sermon_id=`, `?sort=`,
   `?page=`. Arriving with a `sermon_id` (the editor card's deep link) and no
   explicit status defaults to "All" so the sermon's whole thread is visible;
   otherwise the default is "Reported".

   The server owns ordering (auto-hidden first, then by sort) and every role
   rule. The UI only withholds actions a role can't use; a stale gate still
   surfaces the server's 403/404/409 as a message.
   ========================================================================== */

const VIEW_OPTIONS: ReadonlyArray<{ value: CommentView; label: string }> = [
  { value: "all", label: "All" },
  { value: "reported", label: "Reported" },
  { value: "hidden", label: "Hidden" },
];

const SORT_LABEL: Record<CommentSort, string> = {
  most_reported: "Most reported",
  recent: "Most recent",
};

const EMPTY_COPY: Record<CommentView, { title: string; description: string }> = {
  reported: {
    title: "Nothing to review",
    description: "No comments are waiting for a moderator.",
  },
  hidden: { title: "No hidden comments", description: "" },
  all: { title: "No comments yet", description: "" },
};

type ReasonAction = Extract<CommentAction, "hide" | "dismiss" | "delete">;

export function CommentsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { role } = useSession();
  const moderation = useCommentModeration();

  const sermonId = searchParams.get("sermon_id") || undefined;
  const rawStatus = searchParams.get("status");
  const view: CommentView = rawStatus
    ? toCommentView(rawStatus)
    : sermonId
      ? "all"
      : "reported";
  const sort = toCommentSort(searchParams.get("sort"));
  const pageParam = clampPage(searchParams.get("page"));

  const { items, total, page, pageCount, isPending, isError, refetch } =
    useAdminComments({ view, sermonId, sort, page: pageParam });

  const [detail, setDetail] = React.useState<AdminCommentRow | null>(null);
  const [reason, setReason] = React.useState<{
    action: ReasonAction;
    comment: AdminCommentRow;
  } | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const pushSearch = React.useCallback(
    (search: string) => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  const patch = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    return next.toString();
  };

  // Clamp a stale deep page down to the last real one. Wait for the first
  // successful response: until then total is 0 and pageCount is a placeholder 1.
  React.useEffect(() => {
    if (!isPending && !isError && pageParam > pageCount) {
      pushSearch(patch({ page: pageCount > 1 ? String(pageCount) : null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageParam, pageCount, isPending, isError]);

  const showToast = (message: string) => setToast(message);

  // Any moderation mutation in flight — drives the in-flight-disable pattern
  // on every action trigger (row menu items, detail-dialog buttons) so a
  // double click can't fire two writes for the same action, and a second
  // action can't be started mid-flight either.
  const busy =
    moderation.hide.isPending ||
    moderation.restore.isPending ||
    moderation.dismiss.isPending ||
    moderation.hardDelete.isPending;

  async function restore(comment: AdminCommentRow) {
    if (moderation.restore.isPending) return;
    setActionError(null);
    try {
      await moderation.restore.mutateAsync({ id: comment.id });
      setDetail(null);
      showToast("Comment restored.");
    } catch (err) {
      setDetail(null);
      setActionError(moderationErrorMessage(err, "restore"));
    }
  }

  function handleAction(action: CommentAction, comment: AdminCommentRow) {
    setActionError(null);
    if (action === "restore") {
      void restore(comment);
      return;
    }
    setDetail(null);
    setReason({ action, comment });
  }

  async function confirmReason(text: string) {
    if (!reason) return;
    const { action, comment } = reason;
    if (action === "hide") {
      await moderation.hide.mutateAsync({ id: comment.id, reason: text });
      showToast("Comment hidden.");
    } else if (action === "dismiss") {
      await moderation.dismiss.mutateAsync({ id: comment.id, reason: text });
      showToast("Reports dismissed.");
    } else {
      await moderation.hardDelete.mutateAsync({ id: comment.id, reason: text });
      showToast("Comment deleted.");
    }
  }

  const sermonTitle = sermonId
    ? items.find((c) => c.sermon_id === sermonId)?.sermon_title
    : undefined;

  const columns: DataTableColumn<AdminCommentRow>[] = [
    {
      key: "comment",
      header: "Comment",
      gridWidth: "2.6fr",
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-2">
          <span className="line-clamp-2 break-words text-[13.5px] text-ink">
            {row.body}
          </span>
          <span
            title={formatAbsolute(row.created_at)}
            className="font-mono text-[11.5px] text-ink-muted"
          >
            {formatRelative(row.created_at)}
          </span>
        </div>
      ),
    },
    {
      key: "author",
      header: "Author",
      gridWidth: "1.5fr",
      cell: (row) => {
        const email = authorEmailOf(row);
        return (
          <div className="flex min-w-0 items-center gap-10">
            <Avatar name={row.author_display_name} size={28} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] text-ink">
                {row.author_display_name}
              </span>
              {email ? (
                <span className="truncate font-mono text-[11.5px] text-ink-muted">
                  {email}
                </span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      key: "sermon",
      header: "Sermon",
      gridWidth: "1.5fr",
      cell: (row) => (
        <Link
          href={`/sermons/${row.sermon_id}`}
          title={row.sermon_title}
          onClick={(e) => e.stopPropagation()}
          className="truncate text-[13px] text-clay-600 underline-offset-2 hover:underline"
        >
          {row.sermon_title}
        </Link>
      ),
    },
    {
      key: "reports",
      header: "Reports",
      gridWidth: "90px",
      cell: (row) => (
        <span
          className={
            row.report_count > 0 && row.status === "VISIBLE"
              ? "rounded-full bg-wheat-tint px-8 py-2 font-mono text-[13px] text-wheat-text"
              : "font-mono text-[13px] text-ink-muted"
          }
        >
          {row.report_count}
        </span>
      ),
    },
    {
      key: "state",
      header: "State",
      gridWidth: "130px",
      cell: (row) => <CommentStateChip state={commentStateOf(row)} />,
    },
  ];

  const rangeLabel =
    total === 0
      ? "0 of 0"
      : `${(page - 1) * COMMENTS_PAGE_SIZE + 1}–${Math.min(
          page * COMMENTS_PAGE_SIZE,
          total,
        )} of ${total}`;

  const empty = sermonId
    ? { title: "No comments on this sermon yet", description: "" }
    : EMPTY_COPY[view];

  return (
    <div className="flex flex-col gap-20">
      <PageHeader
        title="Comments"
        subhead="Reported and hidden comments across sermons"
      />

      <div className="flex flex-col gap-12">
        <div className="flex flex-wrap items-center gap-10">
          <SegmentedControl<CommentView>
            aria-label="Filter comments by state"
            options={VIEW_OPTIONS}
            value={view}
            onValueChange={(next) => pushSearch(patch({ status: next }))}
          />
          <div className="w-[160px]">
            <Select
              aria-label="Sort comments"
              className="h-[32px] rounded-9 border-border-strong pr-[30px] text-[13px]"
              value={sort}
              onChange={(e) =>
                pushSearch(
                  patch({
                    sort:
                      e.target.value === "most_reported"
                        ? null
                        : e.target.value,
                  }),
                )
              }
            >
              {(Object.keys(SORT_LABEL) as CommentSort[]).map((value) => (
                <option key={value} value={value}>
                  {SORT_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>
          <span className="flex-1" />
          <span
            aria-live="polite"
            className="font-mono text-[12.5px] text-ink-muted"
          >
            {isPending ? "" : `${total} ${total === 1 ? "comment" : "comments"}`}
          </span>
        </div>

        {sermonId ? (
          <div className="flex">
            <span className="inline-flex items-center gap-8 rounded-full bg-canvas py-4 pl-12 pr-6 font-mono text-[12px] text-ink">
              {`Sermon: ${sermonTitle ?? "selected sermon"}`}
              <button
                type="button"
                aria-label="Clear sermon filter"
                onClick={() => pushSearch(patch({ sermon_id: null }))}
                className="flex size-[20px] cursor-pointer items-center justify-center rounded-full text-[14px] leading-none text-ink-muted outline-none hover:text-clay-600 focus-visible:focus-ring-button"
              >
                <span aria-hidden>×</span>
              </button>
            </span>
          </div>
        ) : null}

        {sort === "most_reported" ? (
          <p className="text-[12.5px] text-ink-muted">
            Auto-hidden comments appear first so a wrongful hide is one click
            from restore.
          </p>
        ) : null}

        {actionError ? (
          <Alert variant="error" title={actionError} />
        ) : null}

        <div className="overflow-hidden rounded-14 border border-border bg-surface">
          {isError ? (
            <div className="flex items-center justify-between gap-12 border-b border-border-subtle p-16">
              <Alert variant="error" title="Couldn’t load comments." />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void refetch()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <DataTable<AdminCommentRow>
              className="rounded-none border-0"
              caption="Comments queue"
              columns={columns}
              rows={items}
              rowKey={(row) => row.id}
              loading={isPending}
              rangeLabel={rangeLabel}
              page={page}
              pageCount={pageCount}
              onPageChange={(next) =>
                pushSearch(patch({ page: next > 1 ? String(next) : null }))
              }
              onRowClick={setDetail}
              rowActions={(row) => (
                <RowMenu
                  row={row}
                  role={role}
                  busy={busy}
                  onView={() => setDetail(row)}
                  onAction={(action) => handleAction(action, row)}
                />
              )}
              minWidth={960}
              empty={
                <EmptyState
                  title={empty.title}
                  description={empty.description}
                />
              }
            />
          )}
        </div>
      </div>

      <CommentDetailDialog
        comment={detail}
        role={role}
        busy={busy}
        onAction={handleAction}
        onClose={() => setDetail(null)}
      />
      {reason ? (
        <CommentReasonDialog
          mode={reason.action}
          comment={reason.comment}
          onConfirm={confirmReason}
          onClose={() => setReason(null)}
        />
      ) : null}

      {toast ? (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}

function RowMenu({
  row,
  role,
  busy,
  onView,
  onAction,
}: {
  row: AdminCommentRow;
  role: string;
  busy: boolean;
  onView: () => void;
  onAction: (action: CommentAction) => void;
}) {
  const actions = availableActions(row, role);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for comment by ${row.author_display_name}`}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-8 text-[16px] leading-none text-ink-muted outline-none transition-colors duration-[140ms] ease-out hover:bg-surface-sunken hover:text-ink focus-visible:focus-ring-button data-[state=open]:bg-surface-sunken data-[state=open]:text-ink"
      >
        <span aria-hidden>···</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onView}>View</DropdownMenuItem>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action}
            destructive={action === "delete"}
            disabled={busy}
            onSelect={() => onAction(action)}
          >
            {ACTION_LABEL[action]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

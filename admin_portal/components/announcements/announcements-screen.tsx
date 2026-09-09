"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader } from "@/components/portal";
import { StatusBadge } from "@/components/portal/status-badge";
import { Toast } from "@/components/portal/toast";
import { useSession } from "@/lib/auth/session-context";
import { clampPage } from "@/lib/format";
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENTS_PAGE_SIZE,
  toStatusFilter,
  useAnnouncements,
  type AnnouncementAdminItem,
  type AnnouncementStatusFilter,
} from "@/lib/query/hooks/use-announcements";
import {
  useAnnouncementWorkflow,
  type AnnouncementWorkflowVars,
} from "@/lib/query/hooks/use-announcement-workflow";
import {
  announcementBadgeLabel,
  toBadgeStatus,
} from "@/components/announcements/announcement-status";
import {
  announcementWindow,
  ANNOUNCEMENT_WINDOW_TONE_CLASS,
} from "@/components/announcements/announcement-window";
import { AnnouncementRowMenu } from "@/components/announcements/announcement-row-menu";
import { AnnouncementEditorPanel } from "@/components/announcements/announcement-editor-panel";
import type { AnnouncementRowAction } from "@/components/announcements/row-menu-items";

/* =============================================================================
   AnnouncementsScreen — Announcements (design Screen 8, plan W13).

   `1.4fr 1fr` grid (design + README §8): the list on the left (a W6 DataTable —
   pinned dot, mono Window column, status badge, `···` row menu), the editor on
   the right as an INLINE panel (not a route). URL is the state: `?status=` (the
   filter), `?page=`, `?sel=<id>` (the row loaded into the panel; absent = a
   fresh draft).

   Visibility comes only from the server's `is_visible` on each row — the list
   never flips a row on a client timer. `useAnnouncements` carries a modest
   `refetchInterval`, so a near-future Scheduled row turns Live on the next
   refetch, not by clockwork.

   Approvals live entirely in the row menu — there is no separate announcement
   review-queue screen. Status transitions are not optimistic (W10 precedent);
   failures land in an `<Alert>` atop the table card, never a toast.
   ========================================================================== */

function buildSearch(
  current: URLSearchParams,
  patch: {
    status?: AnnouncementStatusFilter;
    page?: number;
    sel?: string | null;
  },
): string {
  const next = new URLSearchParams(current.toString());
  if ("status" in patch) {
    if (!patch.status || patch.status === "all") next.delete("status");
    else next.set("status", patch.status);
    next.delete("page");
  }
  if ("page" in patch) {
    if (!patch.page || patch.page <= 1) next.delete("page");
    else next.set("page", String(patch.page));
  }
  if ("sel" in patch) {
    if (!patch.sel) next.delete("sel");
    else next.set("sel", patch.sel);
  }
  return next.toString();
}

const CONFIRM_DELETE = (title: string) =>
  `Delete “${title}”? This can’t be undone.`;

export function AnnouncementsScreen() {
  const { role } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = toStatusFilter(searchParams.get("status"));
  const pageParam = clampPage(searchParams.get("page"));
  const selId = searchParams.get("sel");

  const { items, total, page, pageCount, isPending, isError, error } =
    useAnnouncements({ status, page: pageParam });

  const pushSearch = React.useCallback(
    (search: string) => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  // Clamp a stale deep page down to the last real one.
  React.useEffect(() => {
    if (pageCount > 0 && pageParam > pageCount) {
      pushSearch(buildSearch(searchParams, { page: pageCount }));
    }
  }, [pageParam, pageCount, pushSearch, searchParams]);

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [rejectTarget, setRejectTarget] =
    React.useState<AnnouncementAdminItem | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");
  const [toast, setToast] = React.useState<string | null>(null);

  const workflow = useAnnouncementWorkflow({
    onError: (_vars, message) => setActionError(message),
    onSuccess: (vars: AnnouncementWorkflowVars) => {
      setActionError(null);
      if (vars.kind === "delete" && vars.item.id === selId) {
        pushSearch(buildSearch(searchParams, { sel: null }));
      }
      // Only tear the reject-note panel down once the POST has actually
      // landed — a failed reject keeps the panel (and the typed note) so the
      // manager can read the error and retry.
      if (vars.kind === "reject") {
        setRejectTarget(null);
        setRejectNote("");
      }
    },
  });

  const selected = selId
    ? (items.find((row) => row.id === selId) ?? null)
    : null;

  const setStatus = (next: AnnouncementStatusFilter) =>
    pushSearch(buildSearch(searchParams, { status: next }));
  const setPage = (next: number) =>
    pushSearch(buildSearch(searchParams, { page: next }));
  const selectRow = (id: string | null) =>
    pushSearch(buildSearch(searchParams, { sel: id }));

  const handleRowAction = (
    row: AnnouncementAdminItem,
    action: AnnouncementRowAction,
  ) => {
    switch (action) {
      case "edit":
        selectRow(row.id);
        break;
      case "submit":
        workflow.submit(row);
        break;
      case "approve":
        workflow.approve(row);
        break;
      case "publish":
        workflow.publish(row);
        break;
      case "unpublish":
        workflow.unpublish(row);
        break;
      case "archive":
        workflow.archive(row);
        break;
      case "reject":
        setActionError(null);
        setRejectNote("");
        setRejectTarget(row);
        break;
      case "delete":
        if (window.confirm(CONFIRM_DELETE(row.title))) workflow.remove(row);
        break;
    }
  };

  const sendReject = () => {
    if (!rejectTarget) return;
    setActionError(null);
    // Keep the panel + note mounted; `workflow.onSuccess` clears them, a
    // failure leaves them so the note isn't lost.
    workflow.reject(rejectTarget, rejectNote);
  };

  const columns: DataTableColumn<AnnouncementAdminItem>[] = React.useMemo(
    () => [
      {
        key: "title",
        header: "Title",
        gridWidth: "2fr",
        cell: (row) => (
          <div className="flex min-w-0 items-center gap-9">
            <span
              aria-hidden
              className="flex h-[6px] w-[6px] shrink-0 items-center justify-center"
            >
              {row.pinned ? (
                <span className="block h-[6px] w-[6px] rounded-full bg-clay-600" />
              ) : null}
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <span className="truncate text-[14.5px] font-semibold text-ink">
                {row.pinned ? <span className="sr-only">Pinned. </span> : null}
                {row.title}
              </span>
              {row.pinned ? (
                <span className="text-[12.5px] text-ink-faint">pinned</span>
              ) : row.description ? (
                <span className="truncate text-[12.5px] text-ink-faint">
                  {row.description}
                </span>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: "window",
        header: "Window",
        gridWidth: "1.1fr",
        cell: (row) => {
          const w = announcementWindow(row);
          return (
            <span
              data-window-tone={w.tone}
              className={cn(
                "font-mono text-[12px]",
                ANNOUNCEMENT_WINDOW_TONE_CLASS[w.tone],
              )}
            >
              {w.text}
            </span>
          );
        },
      },
      {
        key: "status",
        header: "Status",
        gridWidth: "1fr",
        cell: (row) => (
          <StatusBadge
            status={toBadgeStatus(row.status)}
            label={announcementBadgeLabel(row.status)}
            className="whitespace-nowrap"
          />
        ),
      },
    ],
    [],
  );

  const rangeLabel =
    total === 0
      ? "0 of 0"
      : `${(page - 1) * ANNOUNCEMENTS_PAGE_SIZE + 1}–${Math.min(
          page * ANNOUNCEMENTS_PAGE_SIZE,
          total,
        )} of ${total}`;

  return (
    <>
      <PageHeader
        title="Announcements"
        subhead="Visibility is computed from status, publish date and expiry — nothing flips on a timer."
        actions={
          <Button
            size="md"
            className="h-[34px] rounded-9 px-14 text-[13px]"
            onClick={() => selectRow(null)}
          >
            New announcement
          </Button>
        }
      />

      {/* Split matches the app-shell / editor / series-detail breakpoint
          (min-[1100px]). Below it the list DataTable (minWidth 520) + its ···
          row menu and pagination no longer fit a ~1fr column — stack instead
          (W14 responsive pass). */}
      <div className="grid grid-cols-1 items-start gap-16 min-[1100px]:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-12">
          <div className="w-[184px]">
            <Select
              aria-label="Filter announcements by status"
              className="h-[32px] rounded-9 border-border-strong pr-[30px] text-[13px]"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as AnnouncementStatusFilter)
              }
            >
              <option value="all">All statuses</option>
              {ANNOUNCEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {announcementBadgeLabel(s)}
                </option>
              ))}
            </Select>
          </div>

          <div className="overflow-hidden rounded-16 border border-border bg-surface">
            {(actionError || isError || rejectTarget) && (
              <div className="flex flex-col gap-8 border-b border-border-subtle p-16">
                {isError && (
                  <Alert variant="error" title="Couldn’t load announcements">
                    {error instanceof Error ? error.message : "Please try again."}
                  </Alert>
                )}
                {actionError && (
                  <Alert variant="error" title="That action didn’t go through">
                    <span className="flex items-center gap-10">
                      <span>{actionError}</span>
                      <button
                        type="button"
                        onClick={() => setActionError(null)}
                        className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
                      >
                        Dismiss
                      </button>
                    </span>
                  </Alert>
                )}
                {rejectTarget && (
                  <div className="flex flex-col gap-8">
                    <p className="text-[13.5px] font-medium text-ink">
                      Send “{rejectTarget.title}” back to the editor
                    </p>
                    <Textarea
                      aria-label="Rejection note"
                      rows={3}
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Optional — a note the editor will see."
                    />
                    <div className="flex gap-8">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={workflow.isPending(rejectTarget.id)}
                        onClick={sendReject}
                      >
                        Send back
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRejectTarget(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <DataTable<AnnouncementAdminItem>
              className="rounded-none border-0"
              caption="Announcements"
              columns={columns}
              rows={items}
              rowKey={(row) => row.id}
              onRowClick={(row) => selectRow(row.id)}
              rowActions={(row) => (
                <AnnouncementRowMenu
                  title={row.title}
                  status={row.status}
                  role={role}
                  busy={workflow.isPending(row.id)}
                  onAction={(action) => handleRowAction(row, action)}
                />
              )}
              loading={isPending}
              rangeLabel={rangeLabel}
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              minWidth={520}
              empty={
                <EmptyState
                  title="No announcements yet"
                  description={
                    status === "all"
                      ? "Draft a notice, then publish it to the app feed."
                      : "No announcements match this filter."
                  }
                />
              }
            />
          </div>
        </div>

        <AnnouncementEditorPanel
          key={selected?.id ?? "new"}
          announcement={selected}
          role={role}
          onCreated={(item) => selectRow(item.id)}
          onPrimaryDone={({ target, reachedPublished }) => {
            setToast(
              reachedPublished
                ? "Published to the app feed."
                : target === "submit"
                  ? "Sent for review."
                  : "Saved.",
            );
          }}
        />
      </div>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </>
  );
}

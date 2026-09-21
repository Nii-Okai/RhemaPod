"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";
import { PageHeader } from "@/components/portal";
import { StatusBadge } from "@/components/portal/status-badge";
import { TierChip } from "@/components/portal/chips";
import { Tag } from "@/components/ui/tag";
import { useSession } from "@/lib/auth/session-context";
import { isFuture } from "@/lib/datetime";
import { formatDuration } from "@/lib/format";
import { useSermonCounts, sermonCountLine } from "@/lib/query/hooks/use-sermon-counts";
import { useSeriesList } from "@/lib/query/hooks/use-series";
import { useSpeakers } from "@/lib/query/hooks/use-speakers";
import {
  buildSermonsSearch,
  useSermonsQuery,
  MERGE_CAP,
  type StatusFilter,
  type TierFilter,
} from "@/lib/query/hooks/use-sermons-query";
import {
  useSermonWorkflow,
  type WorkflowRow,
} from "@/lib/query/hooks/use-sermon-workflow";
import type { SermonListItem } from "@/lib/query/hooks/use-sermons";
import { toBadgeStatus } from "@/components/sermons/sermon-status";
import type { RowMenuAction } from "@/components/sermons/row-menu-items";
import { SermonRowMenu } from "@/components/sermons/sermon-row-menu";
import { SermonsFilterBar } from "@/components/sermons/sermons-filter-bar";

/* =============================================================================
   SermonsScreen — Sermons list (design Screen 3, plan W7).

   URL is the state: the filter bar + pagination read from and write to the
   query string (`?status=&speaker=&series=&tier=&q=&page=`). All list/detail
   mutations are optimistic with rollback (`useSermonWorkflow`); failures land
   in an `<Alert>` at the top of the table card, never a toast.
   ========================================================================== */

function seriesCell(row: SermonListItem): string {
  if (!row.series_id || !row.series_title) return "—";
  return row.episode_number != null
    ? `${row.series_title} · ${row.episode_number}`
    : row.series_title;
}

/** True only for a `published` row whose `publish_at` hasn't passed yet — the
    query-time visibility gate (`content_service.sermon_visibility_clause`),
    not a pipeline status, so it never touches `StatusBadge`'s registry. Round
    2 (scheduled-publish authz fix): the review queue drops a scheduled card
    the moment it's approved-and-scheduled, so this list is the only place the
    fact shows at all. */
function isScheduled(row: SermonListItem, now: number): boolean {
  return (
    row.status === "published" &&
    row.publish_at != null &&
    isFuture(row.publish_at, now)
  );
}

function scheduledChipLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const CONFIRM_DELETE = (count: number) =>
  count === 1
    ? "Delete this sermon? This can’t be undone."
    : `Delete ${count} sermons? This can’t be undone.`;

export function SermonsScreen() {
  const { role } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const {
    state,
    rows,
    total,
    page,
    pageCount,
    rangeLabel,
    isPending,
    isError,
    error,
    mergeCapExceeded,
  } = useSermonsQuery();

  const counts = useSermonCounts();
  const speakers = useSpeakers();
  const series = useSeriesList();

  // Fixed at mount, like ReviewScreen's `now` — the "Scheduled · {date}" chip
  // only needs to be accurate for the life of the session, not re-derived on
  // every render.
  const [now] = useState(() => Date.now());

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  // Clear selection + any stale error whenever the view changes (filter, page,
  // search). "3 selected" must never refer to rows the user can no longer see.
  // Done during render (React's "adjust state on a prop change" pattern), not
  // in an effect — no extra commit, no cascading render.
  const searchKey = searchParams.toString();
  const [prevSearchKey, setPrevSearchKey] = useState(searchKey);
  if (searchKey !== prevSearchKey) {
    setPrevSearchKey(searchKey);
    setSelectedKeys(new Set());
    setActionError(null);
  }

  const workflow = useSermonWorkflow({
    onError: setActionError,
    onSuccess: () => {
      setActionError(null);
      setSelectedKeys(new Set());
    },
  });

  /* --- URL writers ---------------------------------------------------- */

  const pushSearch = useCallback(
    (search: string) => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  const setStatus = (status: StatusFilter) =>
    pushSearch(buildSermonsSearch(searchParams, { status }));
  const setSpeaker = (speaker: string | undefined) =>
    pushSearch(buildSermonsSearch(searchParams, { speaker }));
  const setSeries = (value: string | undefined) =>
    pushSearch(buildSermonsSearch(searchParams, { series: value }));
  const setTier = (tier: TierFilter | undefined) =>
    pushSearch(buildSermonsSearch(searchParams, { tier }));
  const setPage = (next: number) =>
    pushSearch(buildSermonsSearch(searchParams, { page: next }));

  /* --- selection → rows --------------------------------------------- */

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.has(row.id)),
    [rows, selectedKeys],
  );
  const toWorkflowRows = (items: SermonListItem[]): WorkflowRow[] =>
    items.map((row) => ({ id: row.id, title: row.title }));

  /* --- row-menu actions ------------------------------------------------ */

  const handleRowAction = (
    row: SermonListItem,
    action: Exclude<RowMenuAction, "edit">,
  ) => {
    const one = [{ id: row.id, title: row.title }];
    switch (action) {
      case "submit":
        workflow.submit(one);
        break;
      case "resubmit":
        workflow.resubmit(one);
        break;
      case "unpublish":
        workflow.unpublish(one);
        break;
      case "publish":
        workflow.publish(one);
        break;
      case "delete":
        if (window.confirm(CONFIRM_DELETE(1))) workflow.remove(one);
        break;
      case "withdraw":
        // Disabled in the menu — no backend transition (GATE 3 Batch 2).
        break;
    }
  };

  /* --- bulk-bar actions --------------------------------------------- */

  const bulkEligibleForSubmit = selectedRows.filter(
    (row) => row.status === "draft" || row.status === "rejected",
  );
  // Only draft/rejected rows can be submitted. When the selection is a mix,
  // name the count on the button so it's clear N of M will go — never a silent
  // partial fire. All-eligible keeps the plain label; 0-eligible disables.
  const submitLabel =
    bulkEligibleForSubmit.length > 0 &&
    bulkEligibleForSubmit.length < selectedRows.length
      ? `Submit ${bulkEligibleForSubmit.length} for review`
      : "Submit for review";

  const handleBulkSubmit = () => {
    if (bulkEligibleForSubmit.length === 0) return;
    workflow.submit(toWorkflowRows(bulkEligibleForSubmit));
  };
  const handleBulkDelete = () => {
    if (selectedRows.length === 0) return;
    if (window.confirm(CONFIRM_DELETE(selectedRows.length))) {
      workflow.remove(toWorkflowRows(selectedRows));
    }
  };

  /* --- columns ------------------------------------------------------- */

  const columns: DataTableColumn<SermonListItem>[] = useMemo(
    () => [
      {
        key: "title",
        header: "Sermon",
        gridWidth: "2.4fr",
        cell: (row) => (
          <div className="flex min-w-0 items-center gap-10">
            {row.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.thumbnail_url}
                alt=""
                className="h-[24px] w-[40px] shrink-0 rounded-4 object-cover"
              />
            ) : (
              <MediaPlaceholder
                scale="thumb"
                aria-hidden
                className="h-[24px] w-[40px] shrink-0 rounded-4 p-0"
              />
            )}
            <Link
              href={`/sermons/${row.id}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-[14.5px] font-semibold text-ink outline-none hover:text-clay-700 focus-visible:focus-ring-button"
            >
              {row.title}
            </Link>
          </div>
        ),
      },
      {
        key: "speaker",
        header: "Speaker",
        gridWidth: "1.1fr",
        cell: (row) => (
          <span className="truncate text-[13.5px] text-ink-muted">
            {row.speaker_name ?? "—"}
          </span>
        ),
      },
      {
        key: "series",
        header: "Series",
        gridWidth: "1fr",
        cell: (row) => (
          <span className="truncate text-[13.5px] text-ink-muted">
            {seriesCell(row)}
          </span>
        ),
      },
      {
        key: "duration",
        header: "Length",
        gridWidth: "84px",
        cell: (row) => (
          <span className="font-mono text-[12.5px] text-ink-muted">
            {row.duration_seconds != null
              ? formatDuration(row.duration_seconds)
              : "—"}
          </span>
        ),
      },
      {
        key: "tier",
        header: "Tier",
        gridWidth: "74px",
        cell: (row) => (
          <TierChip tier={row.tier === "paid" ? "paid" : "free"} />
        ),
      },
      {
        key: "status",
        header: "Status",
        gridWidth: "1.1fr",
        cell: (row) => (
          <div className="flex flex-col items-start gap-4">
            <StatusBadge
              status={toBadgeStatus(row.status)}
              className="whitespace-nowrap"
            />
            {row.publish_at && isScheduled(row, now) ? (
              <Tag className="whitespace-nowrap">
                {`Scheduled · ${scheduledChipLabel(row.publish_at)}`}
              </Tag>
            ) : null}
          </div>
        ),
      },
    ],
    [now],
  );

  const countLine = sermonCountLine(counts.data);

  return (
    <>
      {/* No page-header "New sermon" action: the global top bar already carries
          one, and two identical create buttons top-right read as a bug. The
          empty-state prompt below keeps a create affordance for a cold start. */}
      <PageHeader title="Sermons" subhead={countLine} />

      <SermonsFilterBar
        status={state.status}
        speakerId={state.speakerId}
        seriesId={state.seriesId}
        tier={state.tier}
        speakers={speakers.data}
        series={series.data}
        onStatusChange={setStatus}
        onSpeakerChange={setSpeaker}
        onSeriesChange={setSeries}
        onTierChange={setTier}
      />

      <div className="overflow-hidden rounded-16 border border-border bg-surface">
        {(actionError || isError || mergeCapExceeded) && (
          <div className="flex flex-col gap-8 border-b border-border-subtle p-16">
            {isError && (
              <Alert variant="error" title="Couldn’t load sermons">
                {error instanceof Error ? error.message : "Please try again."}
              </Alert>
            )}
            {mergeCapExceeded && (
              <Alert
                variant="warning"
                title={`Showing the first ${MERGE_CAP} of each state`}
              >
                There are more than {MERGE_CAP} sermons pending or under review —
                this page may be incomplete. Filter by speaker or series to
                narrow it.
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
          </div>
        )}

        <DataTable<SermonListItem>
          className="rounded-none border-0"
          caption="Sermons"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          selectable
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          bulkActions={
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  workflow.isPending || bulkEligibleForSubmit.length === 0
                }
                onClick={handleBulkSubmit}
              >
                {submitLabel}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={workflow.isPending || selectedRows.length === 0}
                onClick={handleBulkDelete}
              >
                Delete
              </Button>
            </>
          }
          onRowClick={(row) => router.push(`/sermons/${row.id}`)}
          rowActions={(row) => (
            <SermonRowMenu
              sermonId={row.id}
              title={row.title}
              status={row.status}
              role={role}
              busy={workflow.isPending}
              onAction={(action) => handleRowAction(row, action)}
            />
          )}
          loading={isPending}
          rangeLabel={rangeLabel}
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          minWidth={900}
          empty={
            <EmptyState
              title="No sermons yet"
              description={
                total === 0 && state.status === "all" && !state.q
                  ? "Draft your first sermon, then submit it for review."
                  : "No sermons match these filters."
              }
              action={
                <Button asChild size="sm">
                  <Link href="/sermons/new">New sermon</Link>
                </Button>
              }
            />
          }
        />
      </div>
    </>
  );
}

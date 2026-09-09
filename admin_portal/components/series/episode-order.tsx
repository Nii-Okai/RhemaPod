"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";
import { StatusBadge } from "@/components/portal/status-badge";
import { toBadgeStatus } from "@/components/sermons/sermon-status";
import { formatDuration } from "@/lib/format";
import { episodeNumberLabel } from "@/lib/series/episodes";
import {
  EPISODE_ORDER_LIMIT,
  useEpisodeReorder,
  useSeriesEpisodes,
} from "@/lib/query/hooks/use-series-episodes";
import type { SermonListItem } from "@/lib/query/hooks/use-sermons";

/* =============================================================================
   EpisodeOrder — the episode-order panel on `/series/[id]` (design Screen 6).

   Header "<series> · episode order" + mono "drag to reorder · gaps allowed".
   Rows (height 56): a drag handle (`⋮⋮`, #C9BFB1, cursor:grab), a mono 2-digit
   episode number, a 40×24 thumb, the title, the duration, a status badge, and
   an accessible up/down move control. Episode numbers need not be contiguous.

   ── Reorder, dependency-free (plan W11 item 4) ──────────────────────────────
   Two ways to move a row, no DnD library (GATE 1 dep list is fixed):
     1. per-row "Move up" / "Move down" buttons — the accessible, keyboard-
        operable path, and the one the tests drive;
     2. native HTML5 drag-and-drop (`draggable` + dragstart/over/drop) as a
        pointer enhancement.
   Either way the move calls `reorderEpisodes`, which keeps the set of
   `episode_number`s already in use (gaps and all) and only reassigns which
   sermon holds which. Each changed episode is one `PATCH /api/v1/sermons/{id}`
   — there is no bulk endpoint (→ [GATE 3 Batch 5]). The UI reorders
   optimistically; any PATCH failure rolls the order back and shows a panel
   `<Alert>` (design §"Errors" — an alert on the panel, never a toast).

   ── Locked rows ────────────────────────────────────────────────────────────
   `PATCH /api/v1/sermons/{id}` does NOT reject an `episode_number` change on a
   `pending_review` / `under_review` sermon (verified — `update_sermon` has no
   status guard). W8 established a client-side lock for those statuses, so this
   panel both disables the move control / drag on a locked row AND — because a
   move of an *unlocked* row past a locked one would otherwise sweep the locked
   row's number into the reassigned span — refuses any move whose span would
   cross a locked row, surfacing a brief inline note instead. `reorderEpisodes`
   enforces the fixed-point rule; the note is the panel's job. Noted in
   `status.md` that the rule belongs server-side, and in a bulk endpoint.

   ── >100 episodes ──────────────────────────────────────────────────────────
   The admin sermon list is `updated_at desc`, not `episode_number`, so a series
   with more than `EPISODE_ORDER_LIMIT` episodes loads an arbitrary recency
   slice — reordering it is meaningless. Past the limit the panel is read-only
   with a notice (→ [GATE 3 Batch 5]).
   ========================================================================== */

const LOCKED_STATUSES: readonly string[] = ["pending_review", "under_review"];

export interface EpisodeOrderProps {
  seriesId: string;
  seriesTitle: string;
}

export function EpisodeOrder({ seriesId, seriesTitle }: EpisodeOrderProps) {
  const query = useSeriesEpisodes(seriesId);
  const episodes = React.useMemo<SermonListItem[]>(
    () => query.data?.episodes ?? [],
    [query.data],
  );
  const overLimit = (query.data?.total ?? 0) > EPISODE_ORDER_LIMIT;
  const [alert, setAlert] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const lockedIds = React.useMemo(
    () =>
      new Set(
        episodes
          .filter((ep) => LOCKED_STATUSES.includes(ep.status))
          .map((ep) => ep.id),
      ),
    [episodes],
  );

  const reorder = useEpisodeReorder({
    seriesId,
    ordered: episodes,
    lockedIds,
    onError: setAlert,
    onBlocked: () =>
      setNote("Can’t move past an episode that’s in review."),
  });

  const dragFrom = React.useRef<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= episodes.length || overLimit) return;
    setAlert(null);
    setNote(null);
    reorder.move(from, to);
  };

  return (
    <Card className="flex flex-col gap-12 p-20">
      <div className="flex items-baseline justify-between gap-12">
        <h2 className="text-section-title text-ink">
          {seriesTitle} · episode order
        </h2>
        <span className="text-mono-meta text-ink-faint">
          drag to reorder · gaps allowed
        </span>
      </div>

      {alert ? (
        <Alert variant="error" title="Couldn’t reorder the episodes">
          <span className="flex items-center gap-10">
            <span>{alert}</span>
            <button
              type="button"
              onClick={() => setAlert(null)}
              className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
            >
              Dismiss
            </button>
          </span>
        </Alert>
      ) : null}

      {overLimit ? (
        <Alert variant="warning" title="Reordering is disabled">
          This series has more than {EPISODE_ORDER_LIMIT} episodes — reordering
          is disabled here.
        </Alert>
      ) : note ? (
        <p role="status" className="text-[12.5px] text-ink-muted">
          {note}
        </p>
      ) : null}

      {query.isPending ? (
        <ul aria-hidden className="flex flex-col">
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex h-[56px] items-center gap-12 border-b border-border-subtle last:border-b-0"
            >
              <span className="h-[14px] w-[14px] rounded-4 bg-border-subtle" />
              <span className="h-[14px] w-[22px] rounded-4 bg-border-subtle" />
              <span className="h-[24px] w-[40px] rounded-4 bg-border-subtle" />
              <span className="h-[14px] flex-1 rounded-4 bg-border-subtle" />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <Alert variant="error" title="Couldn’t load the episodes">
          {query.error instanceof Error
            ? query.error.message
            : "Please try again."}
        </Alert>
      ) : episodes.length === 0 ? (
        <p className="py-8 text-[13px] text-ink-muted">
          No episodes yet. Assign a sermon to this series from the sermon editor,
          and it will appear here to order.
        </p>
      ) : (
        <ul className="flex flex-col" data-slot="episode-order-list">
          {episodes.map((ep, index) => {
            const locked = LOCKED_STATUSES.includes(ep.status);
            const draggable = !locked && !reorder.isPending && !overLimit;
            return (
              <li
                key={ep.id}
                data-episode-id={ep.id}
                draggable={draggable}
                onDragStart={() => {
                  if (draggable) dragFrom.current = index;
                }}
                onDragOver={(e) => {
                  if (dragFrom.current !== null) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragFrom.current;
                  dragFrom.current = null;
                  if (from !== null) move(from, index);
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
                }}
                className="flex h-[56px] items-center gap-12 border-b border-border-subtle last:border-b-0"
              >
                <span
                  aria-hidden
                  className={`select-none text-[13px] leading-none ${
                    draggable ? "cursor-grab" : "cursor-not-allowed"
                  }`}
                  style={{ color: "#C9BFB1" }}
                >
                  ⋮⋮
                </span>

                <span className="w-[22px] shrink-0 font-mono text-[13px] tabular-nums text-ink-muted">
                  {episodeNumberLabel(ep.episode_number)}
                </span>

                {ep.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ep.thumbnail_url}
                    alt=""
                    className="h-[24px] w-[40px] shrink-0 rounded-4 border border-border object-cover"
                  />
                ) : (
                  <MediaPlaceholder
                    scale="thumb"
                    aria-hidden
                    className="h-[24px] w-[40px] shrink-0 rounded-4 p-0"
                  />
                )}

                <span className="flex-1 truncate text-[14px] text-ink">
                  {ep.title}
                </span>

                <span className="shrink-0 font-mono text-[12.5px] text-ink-muted">
                  {ep.duration_seconds != null
                    ? formatDuration(ep.duration_seconds)
                    : "—"}
                </span>

                <StatusBadge
                  status={toBadgeStatus(ep.status)}
                  className="shrink-0 whitespace-nowrap"
                />

                <span className="flex shrink-0 items-center gap-2">
                  <MoveButton
                    label={`Move “${ep.title}” up`}
                    glyph="↑"
                    disabled={
                      locked || overLimit || reorder.isPending || index === 0
                    }
                    onClick={() => move(index, index - 1)}
                  />
                  <MoveButton
                    label={`Move “${ep.title}” down`}
                    glyph="↓"
                    disabled={
                      locked ||
                      overLimit ||
                      reorder.isPending ||
                      index === episodes.length - 1
                    }
                    onClick={() => move(index, index + 1)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function MoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-[24px] items-center justify-center rounded-6 border border-border-strong bg-surface text-[12px] leading-none text-ink-muted outline-none transition-colors duration-150 ease-out hover:bg-surface-sunken focus-visible:focus-ring-button disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-canvas disabled:text-ink-disabled"
    >
      {glyph}
    </button>
  );
}

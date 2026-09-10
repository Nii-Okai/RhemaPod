"use client";

import Link from "next/link";
import { cn } from "cn";

import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/portal/status-badge";
import { formatRelativeTime } from "@/lib/format";
import { latestRejectionNote } from "@/lib/dashboard/rejection-note";
import { useApprovalLog } from "@/lib/query/hooks/use-approval-log";
import {
  useDraftsWip,
  useInFlightUploads,
  useRejectedWip,
  type SermonListItem,
  type UploadJob,
} from "@/lib/query/hooks/use-dashboard";

/* =============================================================================
   WIP cards — "Your work in progress" (design Screen 2, plan §A.1 / W23).

   Rendered for EVERY Dashboard role (editor, manager, admin). One panel, an
   auto-fit grid of three tiles — Drafts, Processing, Rejected — each with a
   real count off a backend field, a short list, an empty state, and a link
   into the matching /sermons view.

   Author-scoped: the Drafts and Rejected reads carry `created_by=me`;
   `/uploads/in-flight` is caller-scoped server-side. A manager/admin sees
   *their own* unfinished work here, not the whole platform's.

   The Rejected tile fetches each rejected sermon's approval log to surface the
   rejection note — for AT MOST 5 sermons (plan §A.1, the accepted N+1). No
   `latest_rejection_note` field is added anywhere.
   ========================================================================== */

/** Titles listed under a tile's count. The reads fetch a slightly larger
    window (`WIP_LIST_LIMIT`); the tile shows the freshest few. */
const TITLES_SHOWN = 3;

/** Hard cap on approval-log fetches from the Rejected tile (plan §A.1). */
export const REJECTED_LOG_CAP = 5;

function TileShell({
  label,
  tileKey,
  count,
  loading,
  error,
  href,
  linkLabel,
  children,
}: {
  label: string;
  tileKey: string;
  count: number | undefined;
  loading: boolean;
  error: boolean;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="wip-tile"
      data-wip={tileKey}
      className="flex flex-col gap-8 rounded-12 border border-border-subtle p-14"
    >
      <div className="flex items-baseline justify-between gap-8">
        <span className="text-[14px] font-semibold text-ink">{label}</span>
        <span
          data-testid={`wip-count-${tileKey}`}
          className="font-mono text-[12px] tabular-nums text-ink-muted"
        >
          {loading ? "…" : error ? "—" : (count ?? 0).toLocaleString("en-US")}
        </span>
      </div>

      <div className="flex min-h-[44px] flex-1 flex-col gap-6">{children}</div>

      <Link
        href={href}
        className="text-[12.5px] font-semibold text-clay-600 underline-offset-2 outline-none hover:underline focus-visible:focus-ring-button"
      >
        {linkLabel} →
      </Link>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      {[0, 1].map((i) => (
        <span key={i} className="h-[13px] w-4/5 rounded-4 bg-border-subtle" />
      ))}
    </div>
  );
}

function TileError({ what }: { what: string }) {
  return (
    <p className="text-[12.5px] text-ink-faint">
      Couldn’t load {what}. Reload to try again.
    </p>
  );
}

function TileEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-ink-faint">{children}</p>;
}

/* --- Drafts --------------------------------------------------------------- */

function DraftsTile() {
  const { data, isPending, isError } = useDraftsWip();
  const total = data?.total ?? 0;
  const items = data?.items ?? [];

  return (
    <TileShell
      label="Drafts"
      tileKey="drafts"
      count={total}
      loading={isPending}
      error={isError}
      href="/sermons?status=drafts"
      linkLabel="Open drafts"
    >
      {isPending ? (
        <TileSkeleton />
      ) : isError ? (
        <TileError what="your drafts" />
      ) : total === 0 ? (
        <TileEmpty>No drafts. Nothing half-written.</TileEmpty>
      ) : (
        <ul className="flex flex-col gap-6">
          {items.slice(0, TITLES_SHOWN).map((sermon) => (
            <li
              key={sermon.id}
              className="flex items-baseline justify-between gap-8"
            >
              <Link
                href={`/sermons/${sermon.id}`}
                className="truncate text-[13px] font-semibold text-ink outline-none hover:text-clay-600 focus-visible:text-clay-600"
              >
                {sermon.title || "Untitled sermon"}
              </Link>
              <span className="shrink-0 font-mono text-[11px] text-ink-faint tabular-nums">
                {formatRelativeTime(
                  new Date(sermon.updated_at ?? sermon.created_at),
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TileShell>
  );
}

/* --- Processing --------------------------------------------------------- */

function jobLabel(job: UploadJob): string {
  return job.original_filename?.trim() || `${job.media_type} upload`;
}

function ProcessingTile() {
  const { data, isPending, isError } = useInFlightUploads();
  const jobs = data ?? [];

  return (
    <TileShell
      label="Processing"
      tileKey="processing"
      count={jobs.length}
      loading={isPending}
      error={isError}
      href="/sermons"
      linkLabel="Open sermons"
    >
      {isPending ? (
        <TileSkeleton />
      ) : isError ? (
        <TileError what="your uploads" />
      ) : jobs.length === 0 ? (
        <TileEmpty>Nothing in the pipeline right now.</TileEmpty>
      ) : (
        <ul className="flex flex-col gap-6">
          {jobs.slice(0, TITLES_SHOWN).map((job) => (
            <li key={job.id} className="flex flex-col gap-3">
              <span className="truncate text-[13px] font-semibold text-ink">
                {jobLabel(job)}
              </span>
              <StatusBadge status={job.status} className="h-[22px] text-[11px]" />
            </li>
          ))}
        </ul>
      )}
    </TileShell>
  );
}

/* --- Rejected --------------------------------------------------------- */

function RejectedItem({
  sermonId,
  title,
}: {
  sermonId: string;
  title: string;
}) {
  const { data } = useApprovalLog(sermonId);
  const note = latestRejectionNote(data);

  return (
    <li className="flex flex-col gap-3">
      <Link
        href={`/sermons/${sermonId}`}
        className="truncate text-[13px] font-semibold text-ink outline-none hover:text-clay-600 focus-visible:text-clay-600"
      >
        {title || "Untitled sermon"}
      </Link>
      {note ? (
        <span
          className="line-clamp-2 text-[12px] text-rose-text"
          data-slot="wip-rejection-note"
        >
          “{note}”
        </span>
      ) : (
        <span className="text-[12px] text-ink-faint">Rejected — see the log.</span>
      )}
    </li>
  );
}

function RejectedTile() {
  const { data, isPending, isError } = useRejectedWip();
  const total = data?.total ?? 0;
  const items = (data?.items ?? []) as SermonListItem[];

  return (
    <TileShell
      label="Rejected"
      tileKey="rejected"
      count={total}
      loading={isPending}
      error={isError}
      href="/sermons"
      linkLabel="Open sermons"
    >
      {isPending ? (
        <TileSkeleton />
      ) : isError ? (
        <TileError what="your rejected sermons" />
      ) : total === 0 ? (
        <TileEmpty>Nothing rejected. Clean slate.</TileEmpty>
      ) : (
        <ul className="flex flex-col gap-8">
          {items.slice(0, REJECTED_LOG_CAP).map((sermon) => (
            <RejectedItem
              key={sermon.id}
              sermonId={sermon.id}
              title={sermon.title}
            />
          ))}
        </ul>
      )}
    </TileShell>
  );
}

/* --- panel ----------------------------------------------------------- */

export function WipCards({ className }: { className?: string }) {
  return (
    <Card className={cn("flex flex-col gap-12", className)}>
      <div className="flex items-center justify-between gap-12">
        <span className="text-[15px] font-semibold text-ink">
          Your work in progress
        </span>
        <Link
          href="/sermons?status=drafts"
          className="text-[13px] text-clay-600 outline-none hover:underline focus-visible:focus-ring-button"
        >
          View all drafts
        </Link>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-12">
        <DraftsTile />
        <ProcessingTile />
        <RejectedTile />
      </div>
    </Card>
  );
}

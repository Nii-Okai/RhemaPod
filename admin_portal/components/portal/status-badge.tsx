import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   StatusBadge — RhemaPod UI Kit primitive (W2). Hand-built (no shadcn base).

   THE ACCESSIBILITY GUARANTEE (plan §A.6, DoD "Status is never colour-only"):
   the leading dot's POSITION along the pipeline rail is the non-colour status
   cue. That position is DERIVED from an ordered status enum — never hand-placed
   per variant — so it cannot silently drift out of sync with the label. The
   single function `statusVisual()` drives every badge; `dotIndex` is always
   `PIPELINE.indexOf(...)`, computed here, not a literal typed per row.

   Off-pipeline statuses (`rejected`, `unpublished`, `archived`) render a hollow
   dot anchored at the pipeline step they left from (review / published), so the
   mark still encodes "where in the pipeline this is" without relying on colour.

   Visual spec: README §"StatusBadge" + RhemaPod UI Kit.dc.html §05 —
   height 26, radius 999, padding 0 11px, 12.5/600, 6px dot, gap 7. The dot RAIL
   (up to ~22px wide) is the one deliberate deviation from the reference's single
   fixed dot; it is the mechanism behind the a11y guarantee. Flagged for the
   design-fidelity pass.
   ========================================================================== */

/** The sermon approval spine, in order. Indices are load-bearing. */
export const SERMON_STATUS_PIPELINE = [
  "draft",
  "pending",
  "under_review",
  "approved",
  "published",
] as const;

/** The media upload spine, in order. */
export const UPLOAD_STATUS_PIPELINE = [
  "awaiting_upload",
  "uploaded",
  "processing",
  "ready",
] as const;

type SermonPipelineStatus = (typeof SERMON_STATUS_PIPELINE)[number];
type UploadPipelineStatus = (typeof UPLOAD_STATUS_PIPELINE)[number];

export type SermonStatus =
  | SermonPipelineStatus
  | "rejected"
  | "unpublished"
  | "archived";
export type UploadStatus = UploadPipelineStatus | "failed";
export type AnyStatus = SermonStatus | UploadStatus;

type Tone =
  | "neutral"
  | "wheat"
  | "slate"
  | "sage"
  | "sage-solid"
  | "rose"
  | "outline";

export interface StatusVisual {
  label: string;
  tone: Tone;
  /** "sermon" | "upload" — which rail the dot is placed on. */
  rail: "sermon" | "upload";
  /** Number of slots on that rail. */
  railLength: number;
  /** Dot position on the rail — always derived from PIPELINE.indexOf(). */
  dotIndex: number;
  /** Filled = on-pipeline; hollow = off-pipeline (fell out at dotIndex). */
  dotFilled: boolean;
  /** True for rejected / unpublished / archived / failed. */
  offPipeline: boolean;
}

const TONE_CLASS: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-neutral-badge text-ink-soft", dot: "bg-ink-faint" },
  wheat: { badge: "bg-wheat-tint text-wheat-text", dot: "bg-wheat" },
  slate: { badge: "bg-slate-tint text-slate-text", dot: "bg-slate" },
  sage: { badge: "bg-sage-tint text-sage-text", dot: "bg-sage" },
  "sage-solid": {
    badge: "bg-sage text-alert-success-bg",
    dot: "bg-sage-dot",
  },
  rose: { badge: "bg-rose-tint text-rose-text", dot: "border border-rose" },
  outline: {
    badge: "border border-border-strong bg-surface text-ink-soft",
    dot: "border border-border-strong",
  },
};

type PipelineStep = SermonPipelineStatus | UploadPipelineStatus;

interface StatusEntry {
  label: string;
  tone: Tone;
  rail: "sermon" | "upload";
  /** The pipeline STEP this status sits at. Its numeric index is derived, never
      written here — see statusVisual(). Off-pipeline statuses name the step they
      left from. */
  dotAnchor: PipelineStep;
  dotFilled: boolean;
  offPipeline: boolean;
}

/* One entry per status. `Record<AnyStatus, StatusEntry>` makes this total by
   construction: a new status is a compile error until it is given a visual. */
const REGISTRY: Record<AnyStatus, StatusEntry> = {
  // ---- sermon approval spine (filled dot, on its own step)
  draft: { label: "Draft", tone: "neutral", rail: "sermon", dotAnchor: "draft", dotFilled: true, offPipeline: false },
  pending: { label: "Pending review", tone: "wheat", rail: "sermon", dotAnchor: "pending", dotFilled: true, offPipeline: false },
  under_review: { label: "Under review", tone: "slate", rail: "sermon", dotAnchor: "under_review", dotFilled: true, offPipeline: false },
  approved: { label: "Approved", tone: "sage", rail: "sermon", dotAnchor: "approved", dotFilled: true, offPipeline: false },
  published: { label: "Published", tone: "sage-solid", rail: "sermon", dotAnchor: "published", dotFilled: true, offPipeline: false },
  // ---- sermon off-pipeline (hollow dot at the step they left from)
  rejected: { label: "Rejected", tone: "rose", rail: "sermon", dotAnchor: "under_review", dotFilled: false, offPipeline: true },
  unpublished: { label: "Unpublished", tone: "outline", rail: "sermon", dotAnchor: "published", dotFilled: false, offPipeline: true },
  archived: { label: "Archived", tone: "outline", rail: "sermon", dotAnchor: "published", dotFilled: false, offPipeline: true },
  // ---- media upload spine
  awaiting_upload: { label: "Awaiting upload", tone: "neutral", rail: "upload", dotAnchor: "awaiting_upload", dotFilled: true, offPipeline: false },
  uploaded: { label: "Uploaded", tone: "slate", rail: "upload", dotAnchor: "uploaded", dotFilled: true, offPipeline: false },
  processing: { label: "Processing", tone: "slate", rail: "upload", dotAnchor: "processing", dotFilled: true, offPipeline: false },
  ready: { label: "Ready", tone: "sage", rail: "upload", dotAnchor: "ready", dotFilled: true, offPipeline: false },
  failed: { label: "Failed", tone: "rose", rail: "upload", dotAnchor: "processing", dotFilled: false, offPipeline: true },
};

/**
 * The single source of truth for how a status renders. Pure and total over
 * every member of `AnyStatus`. `dotIndex` is computed from the ordered PIPELINE
 * arrays via `indexOf` — it is never a hand-written number, so the dot's
 * position cannot drift out of sync with the pipeline order (the a11y
 * guarantee, plan §A.6).
 */
export function statusVisual(status: AnyStatus): StatusVisual {
  const e = REGISTRY[status];
  const pipeline: readonly string[] =
    e.rail === "sermon" ? SERMON_STATUS_PIPELINE : UPLOAD_STATUS_PIPELINE;
  return {
    label: e.label,
    tone: e.tone,
    rail: e.rail,
    railLength: pipeline.length,
    dotIndex: pipeline.indexOf(e.dotAnchor),
    dotFilled: e.dotFilled,
    offPipeline: e.offPipeline,
  };
}

/** Rail step in px between dot slots. */
const RAIL_STEP = 4;
const DOT_SIZE = 6;

type StatusBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  status: AnyStatus;
  /** Override the label text (e.g. "Pending" instead of "Pending review"). */
  label?: string;
};

function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const v = statusVisual(status);
  const tone = TONE_CLASS[v.tone];
  const railWidth = (v.railLength - 1) * RAIL_STEP + DOT_SIZE;

  return (
    <span
      data-slot="status-badge"
      data-status={status}
      data-pipeline-index={v.dotIndex}
      className={cn(
        "text-badge inline-flex h-[26px] w-fit items-center gap-[7px] rounded-full px-11",
        tone.badge,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="relative block shrink-0"
        style={{ width: railWidth, height: DOT_SIZE }}
      >
        <span
          className={cn(
            "absolute top-0 block rounded-full",
            v.dotFilled ? tone.dot : cn(tone.dot, "bg-transparent"),
          )}
          style={{
            left: v.dotIndex * RAIL_STEP,
            width: DOT_SIZE,
            height: DOT_SIZE,
          }}
        />
      </span>
      {label ?? v.label}
    </span>
  );
}

export { StatusBadge };
export type { StatusBadgeProps };

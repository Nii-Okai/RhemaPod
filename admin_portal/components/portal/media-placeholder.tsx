import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   MediaPlaceholder — RhemaPod UI Kit primitive (W2).

   The diagonal-stripe fill for every not-yet-supplied image
   (README §"Media placeholder" + UI Kit §06/§07):
     repeating-linear-gradient(135deg, #E4DDD1 0 Npx, #EFE9DF Npx 2Npx)
   Three stripe scales appear in the reference:
     thumb  4/8  — 40x24 list thumbs (UI Kit §06)
     card   6/12 — 16:9 card media  (UI Kit §07)
     hero   8/16 — login brand image (README screen 1)
   Optional mono caption chip (on surface-sunken) and/or a duration chip
   (on rgba(46,39,35,.72)).
   ========================================================================== */

const STRIPE: Record<"thumb" | "card" | "hero", string> = {
  thumb:
    "repeating-linear-gradient(135deg,#E4DDD1 0 4px,#EFE9DF 4px 8px)",
  card: "repeating-linear-gradient(135deg,#E4DDD1 0 6px,#EFE9DF 6px 12px)",
  hero: "repeating-linear-gradient(135deg,#E4DDD1 0 8px,#EFE9DF 8px 16px)",
};

type MediaPlaceholderProps = React.ComponentProps<"div"> & {
  scale?: "thumb" | "card" | "hero";
  /** mono caption chip, bottom-left (e.g. "thumbnail 16:9 · 1280x720"). */
  caption?: string;
  /** duration chip, bottom-right (e.g. "42:18"). */
  duration?: string;
  /** accessible name; defaults to the caption or "image placeholder". */
  label?: string;
};

function MediaPlaceholder({
  scale = "card",
  caption,
  duration,
  label,
  className,
  style,
  ...props
}: MediaPlaceholderProps) {
  return (
    <div
      data-slot="media-placeholder"
      role="img"
      aria-label={label ?? caption ?? "image placeholder"}
      className={cn(
        "flex items-end justify-between gap-8 overflow-hidden p-10",
        className,
      )}
      style={{ backgroundImage: STRIPE[scale], ...style }}
      {...props}
    >
      {caption ? (
        // UI-Kit HTML caption text is #7A6E62 (no token) — using ink-muted.
        <span className="rounded-4 bg-surface-sunken px-6 py-2 font-mono text-[10.5px] tracking-[0.02em] text-ink-muted">
          {caption}
        </span>
      ) : (
        <span />
      )}
      {duration ? (
        <span className="rounded-4 bg-[rgba(46,39,35,0.72)] px-6 py-2 font-mono text-[11px] tracking-[0.06em] text-surface-sunken">
          {duration}
        </span>
      ) : null}
    </div>
  );
}

export { MediaPlaceholder };
export type { MediaPlaceholderProps };

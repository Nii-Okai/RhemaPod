import type { ReactNode } from "react";
import { cn } from "cn";

/* =============================================================================
   PageHeader — the title block every portal page opens with (W5).

   Design README "Page body": an <h1> in page-title style (Newsreader 32) plus a
   one-line ink-muted subhead at 14.5px. Server-safe — no client hooks.
   ========================================================================== */

export interface PageHeaderProps {
  title: ReactNode;
  subhead: ReactNode;
  /** Right-aligned actions (e.g. a "New sermon" button). */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subhead,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-16", className)}>
      <div className="flex flex-col gap-6">
        <h1 className="text-page-title text-ink">{title}</h1>
        <p className="text-[14.5px] text-ink-muted">{subhead}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-8">{actions}</div> : null}
    </div>
  );
}

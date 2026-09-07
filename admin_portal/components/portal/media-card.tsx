import * as React from "react";
import { cn } from "cn";
import { Card } from "@/components/ui/card";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";

/* =============================================================================
   MediaCard — RhemaPod UI Kit primitive (W2). Hand-built.
   UI Kit §07: rounded-14, overflow-hidden. 16:9 striped media (optional
   caption + duration chips), then body p-14 gap-6 with a Newsreader card-title
   and a 13px ink-muted meta line.
   ========================================================================== */

type MediaCardProps = React.ComponentProps<"div"> & {
  title: React.ReactNode;
  meta?: React.ReactNode;
  caption?: string;
  duration?: string;
};

function MediaCard({
  title,
  meta,
  caption,
  duration,
  className,
  ...props
}: MediaCardProps) {
  return (
    <Card
      data-slot="media-card"
      className={cn("overflow-hidden rounded-14 p-0", className)}
      {...props}
    >
      <MediaPlaceholder
        scale="card"
        caption={caption}
        duration={duration}
        className="aspect-video"
      />
      <div className="flex flex-col gap-6 p-14">
        <span className="text-card-title text-ink">{title}</span>
        {meta ? <span className="text-[13px] text-ink-muted">{meta}</span> : null}
      </div>
    </Card>
  );
}

export { MediaCard };
export type { MediaCardProps };

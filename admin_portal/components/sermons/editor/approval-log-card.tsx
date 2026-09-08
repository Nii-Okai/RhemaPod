"use client";

import { cn } from "cn";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  TimelineEntry,
  TimelineTone,
} from "@/lib/query/hooks/use-approval-log";

/* =============================================================================
   Approval log card (design Screen 4, right column, bottom).

   Newest-first timeline. Each entry: an 8px status-colored dot, a 13.5/600
   headline, an optional quoted note (13px ink-muted), a mono timestamp.
   Read-only, append-only — never editable (plan W8 acceptance: "an Editor can
   read their own rejection note").

   A 404 (shouldn't happen for the owner) renders a quiet inline line, not a
   crash.
   ========================================================================== */

const DOT_CLASS: Record<TimelineTone, string> = {
  neutral: "bg-ink-faint",
  wheat: "bg-wheat",
  slate: "bg-slate",
  sage: "bg-sage",
  rose: "bg-rose",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ApprovalLogCardProps {
  entries: TimelineEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The error was a 404 — sermon gone or not this user's. */
  notFound: boolean;
}

export function ApprovalLogCard({
  entries,
  isLoading,
  isError,
  notFound,
}: ApprovalLogCardProps) {
  return (
    <Card className="flex flex-col gap-14 p-20">
      <CardHeader>
        <CardTitle>Approval log</CardTitle>
      </CardHeader>

      {isLoading ? (
        <div className="flex flex-col gap-12" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-10">
              <span className="mt-[5px] size-[8px] shrink-0 rounded-full bg-border-subtle" />
              <div className="flex flex-1 flex-col gap-6">
                <span className="h-[13px] w-2/3 rounded-4 bg-border-subtle" />
                <span className="h-[11px] w-1/3 rounded-4 bg-border-subtle" />
              </div>
            </div>
          ))}
        </div>
      ) : notFound ? (
        <p className="text-[13px] text-ink-faint">
          Approval history isn’t available for this sermon.
        </p>
      ) : isError ? (
        <p className="text-[13px] text-ink-faint">
          Couldn’t load the approval history. Reload to try again.
        </p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-[13px] text-ink-faint">No history yet.</p>
      ) : (
        <ol className="flex flex-col gap-14">
          {entries.map((entry) => (
            <li key={entry.key} className="flex gap-10">
              <span
                aria-hidden
                className={cn(
                  "mt-[5px] size-[8px] shrink-0 rounded-full",
                  DOT_CLASS[entry.tone],
                )}
              />
              <div className="flex min-w-0 flex-col gap-3">
                <span className="text-[13.5px] font-semibold text-ink">
                  {entry.headline}
                </span>
                {entry.note ? (
                  <span className="text-[13px] text-ink-muted">
                    “{entry.note}”
                  </span>
                ) : null}
                <span className="text-mono-meta text-ink-faint">
                  {formatTimestamp(entry.timestamp)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

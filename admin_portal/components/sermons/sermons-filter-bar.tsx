"use client";

import { SegmentedControl } from "@/components/portal/segmented-control";
import { Select } from "@/components/ui/select";
import type {
  StatusFilter,
  TierFilter,
} from "@/lib/query/hooks/use-sermons-query";
import type { Speaker } from "@/lib/query/hooks/use-speakers";
import type { SeriesListItem } from "@/lib/query/hooks/use-series";

/* =============================================================================
   SermonsFilterBar — the wrapping filter row (design Screen 3).

   status SegmentedControl (All / Drafts / In review / Published) · three 32px
   radius-9 selects (All speakers · All series · Any tier) · a spacer · the
   static mono "sorted by updated ↓" hint (the backend list order; a sort
   CONTROL is out of W7 scope). Any change is pushed straight to the URL by the
   parent and resets the page to 1.
   ========================================================================== */

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "drafts", label: "Drafts" },
  { value: "in-review", label: "In review" },
  { value: "published", label: "Published" },
];

const SELECT_CLASS =
  "h-[32px] rounded-9 border-border-strong pr-[30px] text-[13px]";

export interface SermonsFilterBarProps {
  status: StatusFilter;
  speakerId?: string;
  seriesId?: string;
  tier?: TierFilter;
  speakers?: Speaker[];
  series?: SeriesListItem[];
  onStatusChange: (status: StatusFilter) => void;
  onSpeakerChange: (speakerId: string | undefined) => void;
  onSeriesChange: (seriesId: string | undefined) => void;
  onTierChange: (tier: TierFilter | undefined) => void;
}

export function SermonsFilterBar({
  status,
  speakerId,
  seriesId,
  tier,
  speakers,
  series,
  onStatusChange,
  onSpeakerChange,
  onSeriesChange,
  onTierChange,
}: SermonsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-10">
      <SegmentedControl
        aria-label="Filter sermons by status"
        options={STATUS_OPTIONS}
        value={status}
        onValueChange={onStatusChange}
      />

      <div className="w-[168px]">
        <Select
          aria-label="Filter by speaker"
          className={SELECT_CLASS}
          value={speakerId ?? ""}
          onChange={(event) =>
            onSpeakerChange(event.target.value || undefined)
          }
        >
          <option value="">All speakers</option>
          {speakers?.map((speaker) => (
            <option key={speaker.id} value={speaker.id}>
              {speaker.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-[168px]">
        <Select
          aria-label="Filter by series"
          className={SELECT_CLASS}
          value={seriesId ?? ""}
          onChange={(event) =>
            onSeriesChange(event.target.value || undefined)
          }
        >
          <option value="">All series</option>
          {series?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-[124px]">
        <Select
          aria-label="Filter by tier"
          className={SELECT_CLASS}
          value={tier ?? ""}
          onChange={(event) =>
            onTierChange(
              (event.target.value || undefined) as TierFilter | undefined,
            )
          }
        >
          <option value="">Any tier</option>
          <option value="free">Free</option>
          <option value="paid">Paid</option>
        </Select>
      </div>

      <span className="flex-1" />

      <span className="text-mono-meta shrink-0 text-ink-faint">
        sorted by updated ↓
      </span>
    </div>
  );
}

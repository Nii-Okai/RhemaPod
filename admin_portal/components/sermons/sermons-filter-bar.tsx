"use client";

import { SegmentedControl } from "@/components/portal/segmented-control";
import { Select } from "@/components/ui/select";
import type {
  StatusFilter,
  TierFilter,
} from "@/lib/query/hooks/use-sermons-query";
import type { Category } from "@/lib/query/hooks/use-categories";
import type { Speaker } from "@/lib/query/hooks/use-speakers";
import type { SeriesListItem } from "@/lib/query/hooks/use-series";

/* =============================================================================
   SermonsFilterBar — the wrapping filter row (design Screen 3).

   status SegmentedControl (All / Drafts / In review / Published) · four 32px
   radius-9 selects (All speakers · All series · All categories · Any tier).
   The list itself still sorts updated_at desc (a sort CONTROL is out of W7
   scope) — no visible label for it per Isaac (removed; the order didn't
   change). Any change is pushed straight to the URL by the parent and resets
   the page to 1.
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
  categoryId?: string;
  tier?: TierFilter;
  speakers?: Speaker[];
  series?: SeriesListItem[];
  categories?: Category[];
  onStatusChange: (status: StatusFilter) => void;
  onSpeakerChange: (speakerId: string | undefined) => void;
  onSeriesChange: (seriesId: string | undefined) => void;
  onCategoryChange: (categoryId: string | undefined) => void;
  onTierChange: (tier: TierFilter | undefined) => void;
}

export function SermonsFilterBar({
  status,
  speakerId,
  seriesId,
  categoryId,
  tier,
  speakers,
  series,
  categories,
  onStatusChange,
  onSpeakerChange,
  onSeriesChange,
  onCategoryChange,
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

      <div className="w-[168px]">
        <Select
          aria-label="Filter by category"
          className={SELECT_CLASS}
          value={categoryId ?? ""}
          onChange={(event) =>
            onCategoryChange(event.target.value || undefined)
          }
        >
          <option value="">All categories</option>
          {categories?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
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
    </div>
  );
}

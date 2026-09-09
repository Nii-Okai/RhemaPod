import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/portal/data-table-skeleton";
import { PageHeader } from "@/components/portal";
import { AnnouncementsScreen } from "@/components/announcements/announcements-screen";

/**
 * Announcements (design Screen 8, plan W13).
 *
 * A thin Server Component: the list (filter, pagination, row menu), the inline
 * editor panel and every mutation are client-rendered React Query (plan §A.4),
 * and the screen reads `useSearchParams`, so it sits under a `<Suspense>`
 * boundary with a geometry-matched fallback (design "Loading").
 */
export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<AnnouncementsFallback />}>
      <AnnouncementsScreen />
    </Suspense>
  );
}

function AnnouncementsFallback() {
  return (
    <>
      <PageHeader
        title="Announcements"
        subhead="Visibility is computed from status, publish date and expiry — nothing flips on a timer."
      />
      <div className="grid grid-cols-1 items-start gap-16 md:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-12">
          <span
            aria-hidden
            className="h-[32px] w-[184px] rounded-9 bg-border-subtle"
          />
          <div className="overflow-hidden rounded-16 border border-border bg-surface">
            <DataTableSkeleton
              gridTemplate="2fr 1.1fr 1fr 40px"
              columnCount={3}
              rowActions
              rows={6}
            />
          </div>
        </div>
        <div
          aria-hidden
          className="h-[520px] rounded-16 border border-border bg-surface"
        />
      </div>
    </>
  );
}

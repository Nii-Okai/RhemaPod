import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/portal/data-table-skeleton";
import { PageHeader } from "@/components/portal";
import { SermonsScreen } from "@/components/sermons/sermons-screen";

/**
 * Sermons list (W7) — Phase 1 home route.
 *
 * A thin Server Component: the whole screen is client-rendered (filters,
 * pagination, selection and optimistic mutations are all `"use client"`, plan
 * §A.4), and it reads `useSearchParams`, so it sits under a `<Suspense>`
 * boundary with a geometry-matched fallback (design "Loading: skeletons that
 * match final geometry").
 */
export default function SermonsPage() {
  return (
    <Suspense fallback={<SermonsFallback />}>
      <SermonsScreen />
    </Suspense>
  );
}

function SermonsFallback() {
  return (
    <>
      <PageHeader
        title="Sermons"
        subhead="Draft, review and publish the spoken word."
      />
      <div className="overflow-hidden rounded-16 border border-border bg-surface">
        <DataTableSkeleton
          gridTemplate="44px 2.4fr 1.1fr 1fr 84px 74px 1.1fr 40px"
          columnCount={6}
          selectable
          rowActions
          rows={8}
        />
      </div>
    </>
  );
}

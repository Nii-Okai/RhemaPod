"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/portal";
import { SeriesGrid } from "./series-grid";

/* =============================================================================
   SeriesScreen — the Series manager list route (`/series`, design Screen 6).

   Header + a "New series" primary, then the card grid. Everything below the
   header is client-rendered React Query (grid, per-card counts), so the page
   RSC just mounts this.
   ========================================================================== */

export function SeriesScreen() {
  return (
    <>
      <PageHeader
        title="Series"
        subhead="Group sermons into ordered teaching series."
        actions={
          <Button asChild size="md" className="h-[34px] rounded-9 px-14 text-[13px]">
            <Link href="/series/new">New series</Link>
          </Button>
        }
      />
      <SeriesGrid />
    </>
  );
}

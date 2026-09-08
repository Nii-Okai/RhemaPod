import { EmptyState, PageHeader } from "@/components/portal";

/** Placeholder — the Dashboard is Phase 2 (§C). W5 ships the nav target only. */
export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        subhead="Your unfinished work first, then the platform numbers."
      />
      <EmptyState
        title="Coming soon"
        description="The dashboard is a Phase 2 screen — not in this build."
      />
    </>
  );
}

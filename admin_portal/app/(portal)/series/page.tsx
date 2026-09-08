import { EmptyState, PageHeader } from "@/components/portal";

/** Placeholder — the Series manager is W11. */
export default function SeriesPage() {
  return (
    <>
      <PageHeader
        title="Series"
        subhead="Group sermons into ordered teaching series."
      />
      <EmptyState
        title="Coming soon"
        description="The series manager and episode ordering arrive in W11."
      />
    </>
  );
}

import { EmptyState, PageHeader } from "@/components/portal";

/** Placeholder — the Sermons list is W7. This is the Phase 1 home route. */
export default function SermonsPage() {
  return (
    <>
      <PageHeader
        title="Sermons"
        subhead="Draft, review and publish the spoken word."
      />
      <EmptyState
        title="Coming soon"
        description="The sermons list, filters and bulk actions arrive in W7."
      />
    </>
  );
}

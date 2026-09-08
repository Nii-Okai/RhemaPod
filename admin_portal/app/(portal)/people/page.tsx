import { EmptyState, PageHeader } from "@/components/portal";

/** Placeholder — Speakers & categories is W12. */
export default function PeoplePage() {
  return (
    <>
      <PageHeader
        title="Speakers & categories"
        subhead="Deleting either detaches it from sermons — it never deletes content."
      />
      <EmptyState
        title="Coming soon"
        description="Speaker and category management arrives in W12."
      />
    </>
  );
}

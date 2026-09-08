import { EmptyState, PageHeader } from "@/components/portal";

/** Placeholder — the sermon editor + upload pipeline are W8 / W9. */
export default function NewSermonPage() {
  return (
    <>
      <PageHeader
        title="New sermon"
        subhead="Start a draft, add media, then submit it for review."
      />
      <EmptyState
        title="Coming soon"
        description="The sermon editor arrives in W8, uploads in W9."
      />
    </>
  );
}

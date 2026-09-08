import { EmptyState, PageHeader } from "@/components/portal";

/** Placeholder — Announcements is W13. */
export default function AnnouncementsPage() {
  return (
    <>
      <PageHeader
        title="Announcements"
        subhead="Visibility is computed from status, publish date and expiry — nothing flips on a timer."
      />
      <EmptyState
        title="Coming soon"
        description="The announcements list and editor arrive in W13."
      />
    </>
  );
}

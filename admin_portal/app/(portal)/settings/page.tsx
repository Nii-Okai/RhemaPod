import { EmptyState, PageHeader } from "@/components/portal";

/**
 * Placeholder — Settings is Phase 2 (§C). In the Account nav group, which every
 * role sees, so no `requireRole` here.
 */
export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subhead="Church profile, publishing defaults and the pieces the mobile app reads."
      />
      <EmptyState
        title="Coming soon"
        description="Settings is a Phase 2 screen — not in this build."
      />
    </>
  );
}

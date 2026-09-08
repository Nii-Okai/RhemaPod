import { requireRole } from "@/lib/auth/require-role";
import { EmptyState, PageHeader } from "@/components/portal";

/**
 * Placeholder — Users & roles is Phase 2 (§C). Community nav group, so
 * `requireRole` keeps it 404 for Editors.
 */
export default async function UsersPage() {
  await requireRole("manager");
  return (
    <>
      <PageHeader
        title="Users & roles"
        subhead="Staff accounts, invites and role changes."
      />
      <EmptyState
        title="Coming soon"
        description="Users & roles is a Phase 2 screen — not in this build."
      />
    </>
  );
}

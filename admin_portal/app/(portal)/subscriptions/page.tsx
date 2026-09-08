import { requireRole } from "@/lib/auth/require-role";
import { EmptyState, PageHeader } from "@/components/portal";

/**
 * Placeholder — Subscriptions is Phase 2 (§C). In the Community nav group, so
 * `requireRole` keeps it 404 for Editors, matching the hidden nav group.
 */
export default async function SubscriptionsPage() {
  await requireRole("manager");
  return (
    <>
      <PageHeader
        title="Subscriptions"
        subhead="Members, tiers and billing status."
      />
      <EmptyState
        title="Coming soon"
        description="Subscriptions is a Phase 2 screen — not in this build."
      />
    </>
  );
}

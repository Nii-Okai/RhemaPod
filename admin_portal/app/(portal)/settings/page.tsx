import { requireRole } from "@/lib/auth/require-role";
import { EmptyState, PageHeader } from "@/components/portal";

/**
 * Placeholder — Settings is Phase 2 (§C). Manager/Admin only: `requireRole`
 * returns 404 for an Editor (plan §A.7 layer 4 — 404, not a login redirect, so
 * the route's existence isn't disclosed), matching `/review`, `/users` and
 * `/subscriptions`. The Account nav group is hidden from an Editor too
 * (`nav-config.ts`), so this is the enforcement layer behind that cosmetic
 * gate, not the only one.
 */
export default async function SettingsPage() {
  await requireRole("manager");
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

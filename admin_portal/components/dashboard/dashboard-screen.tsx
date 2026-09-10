import { PageHeader } from "@/components/portal";

import { DashboardAnalytics } from "./dashboard-analytics";
import { WipCards } from "./wip-cards";

/* =============================================================================
   DashboardScreen — the reduced Dashboard, both role variants (plan §A.1, W23).

   Deliberately NOT a client component. The `showAnalytics` branch is resolved
   on the server (in `page.tsx`, off `getServerUser()`), the same way
   `nav-config` keeps the Community group out of an editor's markup. When it is
   `false` the analytics blocks — and their `/admin/analytics/*` fetches — are
   absent from the render tree entirely: not hidden, not placeholdered. There
   is no client-only guard and no flash of manager content.

     editor          greeting + <WipCards />           (nothing else)
     manager / admin greeting + <WipCards /> + <DashboardAnalytics />
   ========================================================================== */

export interface DashboardScreenProps {
  /** First name from the session, or `null` for a plain "Good morning". */
  firstName: string | null;
  /** Server-resolved: true for manager/admin, false for editor. */
  showAnalytics: boolean;
}

export function DashboardScreen({
  firstName,
  showAnalytics,
}: DashboardScreenProps) {
  return (
    <div className="flex flex-col gap-24">
      <PageHeader
        title={firstName ? `Good morning, ${firstName}` : "Good morning"}
        subhead={
          showAnalytics
            ? "Your unfinished work first, then the platform numbers."
            : "Your unfinished work, at a glance."
        }
      />

      <WipCards />

      {showAnalytics ? <DashboardAnalytics /> : null}
    </div>
  );
}

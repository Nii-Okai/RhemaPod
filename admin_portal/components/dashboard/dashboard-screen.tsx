import { PageHeader } from "@/components/portal";
import { greetingFor } from "@/lib/dashboard/greeting";

import { ContentPipelineCard } from "./content-pipeline-card";
import { DashboardAnalytics } from "./dashboard-analytics";

/* =============================================================================
   DashboardScreen — both role variants.

   Deliberately NOT a client component. The `showAnalytics` branch is resolved
   on the server (in `page.tsx`, off `getServerUser()`), the same way
   `nav-config` keeps the Community group out of an editor's markup. When it is
   `false` the analytics blocks — and their `/admin/analytics/*` fetches — are
   absent from the render tree entirely.

     editor          greeting + their own content pipeline
     manager / admin greeting + <DashboardAnalytics /> (period tiles, listening
                     activity, content pipeline, top sermons, all-time totals)
   ========================================================================== */

export interface DashboardScreenProps {
  /** First name from the session, or `null` for the bare greeting. */
  firstName: string | null;
  /** Server-resolved: true for manager/admin, false for editor. */
  showAnalytics: boolean;
  /** Injectable for tests; defaults to the request time. */
  now?: Date;
}

export function DashboardScreen({
  firstName,
  showAnalytics,
  now = new Date(),
}: DashboardScreenProps) {
  const greeting = greetingFor(now);
  return (
    <div className="flex flex-col gap-24">
      <PageHeader title={firstName ? `${greeting}, ${firstName}` : greeting} />

      {showAnalytics ? (
        <DashboardAnalytics />
      ) : (
        <div className="max-w-[560px]">
          <ContentPipelineCard title="Your sermons" />
        </div>
      )}
    </div>
  );
}

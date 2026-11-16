import type { ReactNode } from "react";

import { PageHeader } from "@/components/portal";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { requireRole } from "@/lib/auth/require-role";

/**
 * Settings shell (plan-admin-settings S17): header + role-filtered tabs over
 * /settings/{profile,audit,reports,data}. Manager+ to enter at all (editors 404,
 * matching the Account nav group being hidden from them); each sub-route then
 * enforces its own bar, so Audit trail still 404s a manager.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireRole("manager");
  return (
    <div className="flex flex-col gap-20">
      <PageHeader
        title="Settings"
        subhead="Church profile and app content, the audit trail, usage reports, and data backups."
      />
      <SettingsTabs />
      {children}
    </div>
  );
}

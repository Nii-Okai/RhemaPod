import { DevotionalSettingsScreen } from "@/components/settings/devotional-settings-screen";
import { requireRole } from "@/lib/auth/require-role";

/** Settings › Devotionals (plan-daily-devotional A5). Manager+, like the
    backend's PATCH /admin/settings/devotionals. */
export default async function DevotionalSettingsPage() {
  await requireRole("manager");
  return <DevotionalSettingsScreen />;
}

import { ProfileScreen } from "@/components/settings/profile-screen";
import { requireRole } from "@/lib/auth/require-role";

/** Settings › Profile — managers and admins edit (D7). FastAPI's manager+
    guard on `/admin/settings` is the real enforcement. */
export default async function SettingsProfilePage() {
  await requireRole("manager");
  return <ProfileScreen />;
}

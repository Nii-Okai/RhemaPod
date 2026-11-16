import { DataScreen } from "@/components/settings/data-screen";
import { requireRole } from "@/lib/auth/require-role";

/** Settings › Data — database export / import, admin only: a manager gets a
    404 here, like Audit trail. FastAPI's AdminOnly guard on `/admin/data/*`
    is the real enforcement. */
export default async function SettingsDataPage() {
  await requireRole("admin");
  return <DataScreen />;
}

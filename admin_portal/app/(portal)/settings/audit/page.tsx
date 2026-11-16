import { AuditScreen } from "@/components/settings/audit-screen";
import { requireRole } from "@/lib/auth/require-role";

/** Settings › Audit trail — admin only (D7): a manager gets a 404 here, not
    a disabled tab. FastAPI's AdminOnly guard on `/admin/audit` is the real
    enforcement. */
export default async function SettingsAuditPage() {
  await requireRole("admin");
  return <AuditScreen />;
}

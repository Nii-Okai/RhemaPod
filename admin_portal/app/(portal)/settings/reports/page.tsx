import { ReportsScreen } from "@/components/settings/reports-screen";
import { requireRole } from "@/lib/auth/require-role";

/** Settings › Reports — managers view, admins also export (D1). The export
    control is rendered from the server-resolved role; FastAPI's AdminOnly
    guard on the export route is the real enforcement. */
export default async function SettingsReportsPage() {
  const user = await requireRole("manager");
  return <ReportsScreen canExport={user.role === "admin"} />;
}

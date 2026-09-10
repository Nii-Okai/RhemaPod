import { requireRole } from "@/lib/auth/require-role";
import { UsersScreen } from "@/components/users/users-screen";

/**
 * Users & roles (design Screen 10, plan W17).
 *
 * A thin Server Component: `requireRole` keeps the route 404 for Editors (the
 * Community nav group is hidden for them, and FastAPI gates the data calls
 * regardless); everything below — the `role-counts` tiles, the staff list, the
 * role filter, the inline role change and the invite dialog — is client React
 * Query, so this just mounts the screen.
 */
export default async function UsersPage() {
  await requireRole("manager");
  return <UsersScreen />;
}

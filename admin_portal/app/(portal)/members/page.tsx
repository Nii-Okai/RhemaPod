import { requireRole } from "@/lib/auth/require-role";
import { MembersScreen } from "@/components/users/members-screen";

/**
 * Mobile users — admin only. `requireRole("admin")` 404s everyone else (the
 * nav item is hidden for them too); FastAPI's admin guard on
 * `GET /users/members` is the real enforcement.
 */
export default async function MembersPage() {
  await requireRole("admin");
  return <MembersScreen />;
}

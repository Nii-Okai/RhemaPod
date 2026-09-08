import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { QueryProvider } from "@/lib/query/provider";
import { getServerUser } from "@/lib/auth/session";
import { SessionProvider } from "@/lib/auth/session-context";
import { AppShell } from "@/components/portal/app-shell";
import { navGroupsForRole } from "@/components/portal/nav-config";

/**
 * `(portal)` bootstrap + shell (plan §A.2 "Session bootstrap", §A.4, §A.7; W5).
 *
 * Server Component: resolve the signed-in user from `rp_at`; on any failure
 * send them to `/login`. The role-gated nav tree is computed HERE, server-side
 * (`navGroupsForRole`), so an Editor's HTML never contains the Community group
 * — no client guard, no flash. It is cosmetic: `require_role` on FastAPI is the
 * real enforcement, and manager-only pages additionally gate with
 * `requireRole()` → 404.
 *
 * `AppShell` is the client half — it owns the live nav counts (React Query) and
 * the <1100px drawer state.
 */
export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getServerUser();
  if (!user) {
    redirect("/login");
  }

  const groups = navGroupsForRole(user.role);

  return (
    <SessionProvider user={user}>
      <QueryProvider>
        <AppShell user={user} groups={groups}>
          {children}
        </AppShell>
      </QueryProvider>
    </SessionProvider>
  );
}

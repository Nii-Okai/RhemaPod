import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { QueryProvider } from "@/lib/query/provider";
import { getServerUser } from "@/lib/auth/session";
import { SessionProvider } from "@/lib/auth/session-context";

/**
 * `(portal)` bootstrap (plan §A.2 "Session bootstrap", §A.4, §A.7).
 *
 * Server Component: resolve the signed-in user server-side from `rp_at`; on any
 * failure send them to `/login`. On success, mount the client `SessionProvider`
 * (the value W5's role-gated nav reads) and the React Query provider W3
 * delivered but left unwired.
 *
 * The full shell — sidebar, top bar, role-gated nav — is W5. This is the
 * minimal bootstrap W4 needs.
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

  return (
    <SessionProvider user={user}>
      <QueryProvider>
        <div className="min-h-screen bg-canvas text-ink">{children}</div>
      </QueryProvider>
    </SessionProvider>
  );
}

import type { ReactNode } from "react";

/* Placeholder frame for the (portal) route group.

   The real shell — a Server Component that bootstraps GET /auth/me,
   feeds a client SessionProvider and renders the role-gated sidebar +
   top bar — is W5 (plan §A.4 / §A.7). For W1 this only wraps the
   token-audit reference page. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-canvas text-ink">{children}</div>;
}

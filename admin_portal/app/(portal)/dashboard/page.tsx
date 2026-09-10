import { redirect } from "next/navigation";

import { getServerUser } from "@/lib/auth/session";
import { firstNameOf } from "@/lib/dashboard/greeting";
import { dashboardShowsAnalytics } from "@/lib/dashboard/variant";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";

/**
 * Dashboard (design Screen 2, plan §A.1 / W23) — the reduced, two-variant
 * landing screen.
 *
 * Server Component. `requireRole` is deliberately NOT called: every role may
 * open `/dashboard`. The variant is a RENDERING decision, resolved here off
 * the session role (`getServerUser()`), exactly like `nav-config` does for the
 * Community nav group:
 *
 *   editor          → `showAnalytics = false` → `<DashboardScreen>` renders
 *                     the greeting + the three WIP cards only. `DashboardAnalytics`
 *                     is never in the tree, so its `/admin/analytics/*` queries
 *                     never fire — no 403 in an editor's network log because
 *                     there is no call.
 *   manager / admin → `showAnalytics = true` → the full screen.
 *
 * `getServerUser()` is React-`cache()`d, so this shares the layout's single
 * `/auth/me` round-trip. `(portal)/layout.tsx` already redirects an anonymous
 * request to `/login`; the guard here is belt-and-braces and narrows the type.
 */
export default async function DashboardPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardScreen
      firstName={firstNameOf(user.name)}
      showAnalytics={dashboardShowsAnalytics(user.role)}
    />
  );
}

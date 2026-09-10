/**
 * Dashboard role branch (plan §A.1 / decision 1a, W23).
 *
 * The Dashboard has exactly two shapes and the session role decides which,
 * resolved SERVER-SIDE — the same way `components/portal/nav-config.ts` keeps
 * the Community nav group out of an editor's markup:
 *
 *   editor          greeting + the three WIP cards. Nothing else — the four
 *                   stat tiles, the New listeners chart and Top sermons are
 *                   absent from the render tree, and their `/admin/analytics/*`
 *                   fetches never fire (they live inside a component this
 *                   returns `false` for).
 *   manager / admin greeting + WIP cards + the analytics blocks.
 *
 * This is a rendering decision, not a permission tier: `/dashboard` calls
 * neither `require_role` (backend) nor `requireRole` (page gate) — every role
 * may open it. The three `/admin/analytics/*` routes keep their own
 * `require_role(MANAGER, ADMIN)` guard unchanged; this predicate only decides
 * whether the frontend asks.
 *
 * Pure — unit-tested directly, no DOM, no hooks. It is deliberately the same
 * role set as `roleSeesCommunity`, kept as its own function so the Dashboard's
 * branch does not silently follow a change made for the nav.
 */

export function dashboardShowsAnalytics(role: string): boolean {
  return role === "manager" || role === "admin";
}

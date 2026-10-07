/* =============================================================================
   Sidebar navigation — data + pure resolvers (W5).

   The nav tree is DATA (plan §A.7 layer 3): `{ group, label, href, count? }`.
   The layout renders it from the server-resolved session role, so an Editor
   never receives the Community markup — no client-only guard, no flash.

   ROUTING SCHEME (plan §5 of the W5 brief): no `/admin/` prefix. This app *is*
   the admin portal, so `/sermons`, `/series`, `/review`, `/settings`, … — the
   design text's `/admin/sermons` is for a portal mounted under a larger site,
   which this is not. `app/page.tsx` redirects `/` → `/sermons` (the Phase 1
   home until the Dashboard ships in Phase 2). Route names follow plan §A.1
   (`/people` for "Speakers & categories", `/review` for the queue).

   Everything here is a pure function so it is unit-tested directly, with no DOM.
   ========================================================================== */

/** Which live count (if any) a nav item shows on its trailing edge. */
export type NavCountKey = "sermons" | "series" | "reviewQueue" | "comments";

export interface NavItem {
  label: string;
  href: string;
  /** Trailing count source. `reviewQueue` and `comments` render as the clay-600 pill. */
  count?: NavCountKey;
  /** Hidden from an Editor — manager/admin only (same role check as
      `roleSeesCommunity`). Cosmetic, like the group-level filter below: the
      route itself is the real gate (`requireRole()`, 404 not redirect). */
  managerOnly?: boolean;
}

export interface NavGroup {
  /** Stable id — the role filter and tests key on this, never the eyebrow copy. */
  id: "overview" | "library" | "workflow" | "community" | "account";
  /** Mono-uppercase eyebrow above the group's items. */
  eyebrow: string;
  items: NavItem[];
}

const OVERVIEW: NavGroup = {
  id: "overview",
  eyebrow: "Overview",
  items: [{ label: "Dashboard", href: "/dashboard" }],
};

const LIBRARY: NavGroup = {
  id: "library",
  eyebrow: "Library",
  items: [
    { label: "Sermons", href: "/sermons", count: "sermons" },
    { label: "Sermon editor", href: "/sermons/new" },
    { label: "Series", href: "/series", count: "series" },
    { label: "Speakers & categories", href: "/people" },
  ],
};

const WORKFLOW: NavGroup = {
  id: "workflow",
  eyebrow: "Workflow",
  items: [
    {
      label: "Review queue",
      href: "/review",
      count: "reviewQueue",
      managerOnly: true,
    },
    // Visible to every staff role: an Editor gets a read view of comments on
    // their own sermons (server-scoped), so this is NOT `managerOnly`.
    { label: "Comments", href: "/comments", count: "comments" },
    { label: "Announcements", href: "/announcements" },
  ],
};

const COMMUNITY: NavGroup = {
  id: "community",
  eyebrow: "Community",
  items: [
    { label: "Subscriptions", href: "/subscriptions" },
    { label: "Users & roles", href: "/users" },
  ],
};

const ACCOUNT: NavGroup = {
  id: "account",
  eyebrow: "Account",
  items: [{ label: "Settings", href: "/settings" }],
};

/** Every group, in render order. Do not mutate — `navGroupsForRole` copies. */
export const NAV_GROUPS: readonly NavGroup[] = [
  OVERVIEW,
  LIBRARY,
  WORKFLOW,
  COMMUNITY,
  ACCOUNT,
];

/** Roles that see the Community group — and every other manager-only group
    or item (`ACCOUNT`'s "Settings", `WORKFLOW`'s "Review queue"). Managers +
    admins; Editors do not. One check, reused everywhere role visibility is
    cosmetically gated in the nav (the name stays `*Community` since that's
    the group most callers/tests reach for it through). */
export function roleSeesCommunity(role: string): boolean {
  return role === "manager" || role === "admin";
}

const MANAGER_ONLY_GROUPS: ReadonlySet<NavGroup["id"]> = new Set([
  "community",
  "account",
]);

/**
 * The nav tree for a role.
 *
 * COSMETIC ONLY. Hiding a group/item keeps an Editor from seeing chrome they
 * cannot use; `require_role` on the FastAPI side is the real enforcement
 * (plan §A.7 layer 1). A hand-crafted request to `/subscriptions` or
 * `/settings` still renders the shell — the manager-only *pages* gate
 * themselves with `requireRole()` and return 404 (see
 * `lib/auth/require-role.ts`).
 *
 * `COMMUNITY` and `ACCOUNT` are hidden whole (every item in each is
 * manager-only today). `WORKFLOW` mixes visibility — "Announcements" stays
 * for an Editor, "Review queue" doesn't — so it's filtered per-item via
 * `NavItem.managerOnly` instead.
 */
export function navGroupsForRole(role: string): NavGroup[] {
  const seesManagerOnly = roleSeesCommunity(role);
  return NAV_GROUPS.filter(
    (group) => seesManagerOnly || !MANAGER_ONLY_GROUPS.has(group.id),
  ).map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => seesManagerOnly || !item.managerOnly,
    ),
  }));
}

/**
 * The single nav href that the current pathname activates, by longest-prefix
 * match, or `null` for none.
 *
 * Longest-prefix so a nested route resolves to its section: `/sermons/123`
 * lights "Sermons" (`/sermons`), while `/sermons/new` lights "Sermon editor"
 * (`/sermons/new`) because that href is the longer match. An exact hit always
 * wins over a prefix hit of a shorter href.
 */
export function resolveActiveHref(
  pathname: string,
  groups: readonly NavGroup[] = NAV_GROUPS,
): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const { href } of group.items) {
      const isMatch = pathname === href || pathname.startsWith(`${href}/`);
      if (isMatch && (best === null || href.length > best.length)) {
        best = href;
      }
    }
  }
  return best;
}

/** Whether a specific nav item is the active one for `pathname`. */
export function isNavItemActive(
  href: string,
  pathname: string,
  groups: readonly NavGroup[] = NAV_GROUPS,
): boolean {
  return resolveActiveHref(pathname, groups) === href;
}

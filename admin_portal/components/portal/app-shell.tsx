"use client";

import { useEffect, useReducer } from "react";
import { usePathname } from "next/navigation";

import type { SessionUser } from "@/lib/auth/session-types";
import { useNavCounts } from "@/lib/query/hooks/use-nav-counts";

import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { drawerReducer } from "./drawer";
import type { NavGroup } from "./nav-config";

/* =============================================================================
   AppShell — the client composition of the portal chrome (W5).

   `(portal)/layout.tsx` (a Server Component) resolves the session and the
   role-filtered nav tree, then hands them here. This component owns only what
   needs the client: the live nav counts (React Query) and the <1100px drawer
   state (`drawerReducer`, in ./drawer). Below 1100px the two-column grid
   collapses to one and the sidebar becomes a fixed overlay toggled from the
   top bar (design README → "Responsive").
   ========================================================================== */

const NAV_DRAWER_ID = "portal-nav-drawer";

export interface AppShellProps {
  user: SessionUser;
  /** Nav groups, already filtered by role in the RSC layout. */
  groups: NavGroup[];
  children: React.ReactNode;
}

export function AppShell({ user, groups, children }: AppShellProps) {
  const counts = useNavCounts();
  const pathname = usePathname();
  const [drawerOpen, dispatch] = useReducer(drawerReducer, false);

  // Close the drawer on any navigation (link click, search submit).
  useEffect(() => {
    dispatch({ type: "close" });
  }, [pathname]);

  // Esc closes the drawer while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") dispatch({ type: "close" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-surface-sunken min-[1100px]:grid min-[1100px]:grid-cols-[248px_1fr]">
      {/* Desktop rail — grid column 1, sticky, self-scrolling. */}
      <div className="sticky top-0 hidden h-screen min-[1100px]:block">
        <Sidebar groups={groups} user={user} counts={counts} />
      </div>

      {/* Mobile drawer — fixed overlay, never shown ≥1100px. */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 min-[1100px]:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Portal navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => dispatch({ type: "close" })}
            className="absolute inset-0 bg-ink/25"
          />
          <div className="absolute inset-y-0 left-0 shadow-toast">
            <Sidebar
              id={NAV_DRAWER_ID}
              groups={groups}
              user={user}
              counts={counts}
              onNavigate={() => dispatch({ type: "close" })}
              onClose={() => dispatch({ type: "close" })}
            />
          </div>
        </div>
      ) : null}

      {/* Main column. */}
      <div className="flex min-w-0 flex-col">
        <TopBar
          navId={NAV_DRAWER_ID}
          onMenuClick={() => dispatch({ type: "open" })}
        />
        <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-24 p-28">
          {children}
        </div>
      </div>
    </div>
  );
}

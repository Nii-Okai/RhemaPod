"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

import { useSession } from "@/lib/auth/session-context";

/* =============================================================================
   SettingsTabs — the sub-nav shared by /settings/{profile,audit,reports}
   (plan-admin-settings S17).

   Tabs are hidden by role, mirroring each route's own `requireRole`: Profile
   and Reports for managers and admins, Audit trail for admins only (D7). This
   is cosmetic — the route 404s below its bar and FastAPI 403s the data call.
   ========================================================================== */

const TABS = [
  { href: "/settings/profile", label: "Profile", adminOnly: false },
  { href: "/settings/audit", label: "Audit trail", adminOnly: true },
  { href: "/settings/reports", label: "Reports", adminOnly: false },
] as const;

export function settingsTabsForRole(role: string) {
  return TABS.filter((t) => !t.adminOnly || role === "admin");
}

export function SettingsTabs() {
  const { role } = useSession();
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex gap-4 border-b border-border">
      {settingsTabsForRole(role).map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-12 py-8 text-[14px] font-medium transition-colors",
              active
                ? "border-clay-600 text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

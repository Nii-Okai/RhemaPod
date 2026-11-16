"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

import type { SessionUser } from "@/lib/auth/session-types";
import type { NavCounts } from "@/lib/query/hooks/use-nav-counts";

import { Avatar } from "./avatar";
import { SignOutButton } from "./sign-out-button";
import {
  isNavItemActive,
  type NavCountKey,
  type NavGroup,
} from "./nav-config";

/* =============================================================================
   Sidebar — the 248px shell rail (W5).

   Design README "App shell" → Sidebar. Fixed 248px, canvas fill, right border,
   sticky full-height, independent scroll; wordmark, grouped nav with
   mono-uppercase eyebrows, a flex spacer, then an account footer above a top
   rule. Nav item: 36px tall, radius 9, space-between; inactive → hover → active
   states verbatim from the spec. Trailing counts in Plex Mono; the review-queue
   count is a clay-600 pill.

   Presentational: `groups` is pre-filtered by role in `(portal)/layout.tsx`
   (server-side, so an Editor's HTML never contains the Community group). Active
   state is the one thing resolved here — from `usePathname`, never local state.
   ========================================================================== */

function Wordmark() {
  return (
    <span
      className="inline-flex select-none items-baseline text-ink"
      style={{ fontSize: 21, lineHeight: 1 }}
      aria-label="RhemaPod"
    >
      <span className="font-serif" style={{ letterSpacing: "0.01em" }}>
        Rhema
      </span>
      <span
        className="font-sans font-semibold text-clay-600"
        style={{ marginLeft: 1 }}
      >
        Pod
      </span>
    </span>
  );
}

/** The pill's text: capped at "99+" so a long queue never widens the rail. */
export function commentsCountLabel(value: number): string {
  return value > 99 ? "99+" : String(value);
}

function TrailingCount({
  kind,
  value,
}: {
  kind: NavCountKey;
  value: number | null;
}) {
  if (value === null) return null;

  if (kind === "reviewQueue" || kind === "comments") {
    if (value <= 0) return null;
    return (
      <span
        aria-hidden={kind === "comments" ? true : undefined}
        className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-clay-600 px-[6px] font-mono text-[11px] leading-none text-on-clay"
      >
        {kind === "comments" ? commentsCountLabel(value) : value}
      </span>
    );
  }

  return <span className="font-mono text-[11px] text-ink-faint">{value}</span>;
}

/** Accessible name override: the comments pill is aria-hidden, so the link
    itself says "Comments, 3 reported". Other links keep their text name. */
function navLinkLabel(
  item: NavGroup["items"][number],
  counts: NavCounts,
): string | undefined {
  if (item.count !== "comments") return undefined;
  const n = counts.comments;
  if (n === null || n <= 0) return undefined;
  return `${item.label}, ${commentsCountLabel(n)} reported`;
}

export interface SidebarProps {
  groups: NavGroup[];
  user: SessionUser;
  counts: NavCounts;
  /** Called after a nav link is followed — closes the mobile drawer. */
  onNavigate?: () => void;
  /** Rendered only in the mobile drawer, to dismiss it. */
  onClose?: () => void;
  id?: string;
  className?: string;
}

export function Sidebar({
  groups,
  user,
  counts,
  onNavigate,
  onClose,
  id,
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const roleLabel = user.role
    ? user.role[0].toUpperCase() + user.role.slice(1)
    : "";

  return (
    <div
      id={id}
      className={cn(
        "flex h-screen w-[248px] flex-col gap-20 overflow-y-auto border-r border-border bg-canvas px-14 py-20",
        className,
      )}
    >
      <div className="flex items-center justify-between px-8">
        <Wordmark />
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-8 px-8 text-[18px] leading-none text-ink-muted hover:bg-border-subtle hover:text-ink focus-visible:focus-ring-button min-[1100px]:hidden"
          >
            ×
          </button>
        ) : null}
      </div>

      <nav aria-label="Portal" className="flex flex-col gap-20">
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <div className="px-8 py-6 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              {group.eyebrow}
            </div>
            {group.items.map((item) => {
              const active = isNavItemActive(item.href, pathname, groups);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={navLinkLabel(item, counts)}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-[36px] items-center justify-between gap-8 rounded-9 px-[10px] text-[14px] transition-colors duration-150 ease-out focus-visible:focus-ring-button",
                    active
                      ? "bg-surface font-semibold text-ink shadow-nav-active"
                      : "font-medium text-ink-soft hover:bg-border-subtle",
                  )}
                >
                  <span className="truncate">{item.label}</span>
                  {item.count ? (
                    <TrailingCount
                      kind={item.count}
                      value={counts[item.count]}
                    />
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-10 border-t border-border pt-16">
        <Avatar name={user.name ?? user.email} size={32} tint="clay" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-semibold text-ink">
            {user.name ?? user.email}
          </span>
          <span className="text-[11.5px] text-ink-faint">{roleLabel}</span>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

/* =============================================================================
   TopBar — the 60px sticky header (W5).

   Design README "App shell" → Top bar. 60px, surface fill, bottom rule, sticky,
   z-index 5, 28px side padding. Left: the search input (max-w 340). Right: the
   environment label in Plex Mono, then the primary "New sermon" button. Below
   1100px a hamburger appears on the far left to open the nav drawer.

   Search is deliberately shallow (non-goal: a global search is Phase 2). On
   submit it just pushes `?q=` onto the sermons route.
   ========================================================================== */

// TODO(settings): source the church name + environment from `GET /settings`
// once that screen exists (Phase 2). Hardcoded for now.
const ENV_LABEL = "Grace Chapel · development";

export interface TopBarProps {
  /** Opens the mobile nav drawer. Button is hidden ≥1100px. */
  onMenuClick: () => void;
  /** id of the drawer the hamburger controls, for aria-controls. */
  navId: string;
}

export function TopBar({ onMenuClick, navId }: TopBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `/sermons?q=${encodeURIComponent(q)}` : "/sermons");
  }

  return (
    <header className="sticky top-0 z-[5] flex h-[60px] items-center gap-14 border-b border-border-subtle bg-surface px-28">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        aria-controls={navId}
        className="rounded-9 px-8 text-[18px] leading-none text-ink-muted hover:bg-surface-sunken hover:text-ink focus-visible:focus-ring-button min-[1100px]:hidden"
      >
        ☰
      </button>

      <form onSubmit={onSearch} className="min-w-0 flex-1" role="search">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sermons, series, speakers"
          aria-label="Search sermons, series, speakers"
          className="h-[34px] w-full max-w-[340px] rounded-9 border border-border bg-surface-sunken px-12 text-[13.5px] text-ink outline-none transition-colors duration-150 ease-out placeholder:text-ink-faint focus:border-clay-600 focus:bg-surface"
        />
      </form>

      <span className="hidden font-mono text-[11.5px] text-ink-faint sm:inline">
        {ENV_LABEL}
      </span>

      <Button
        asChild
        size="md"
        className="h-[34px] shrink-0 rounded-9 px-14 text-[13px]"
      >
        <Link href="/sermons/new">New sermon</Link>
      </Button>
    </header>
  );
}

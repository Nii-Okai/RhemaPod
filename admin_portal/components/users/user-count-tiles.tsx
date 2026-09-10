"use client";

import * as React from "react";

import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { useRoleCounts } from "@/lib/query/hooks/use-users";

/* =============================================================================
   UserCountTiles — the four headcount cards on Users & roles (design Screen 10).

   `minmax(180px, 1fr)` auto-fit grid, gap 12; each card is border/radius-12,
   padding 16: a 13px ink-muted label over a 24/600 count. Fed by the
   full-table `GET /users/role-counts` aggregate — so the **Viewers** tile
   shows a real number even though a viewer is never a row in the list beside
   it (plan §A.6). Loading keeps the card geometry and swaps the number for a
   matched block; a failed aggregate shows a single card-top alert, not four
   broken tiles.
   ========================================================================== */

const TILES = [
  { key: "viewer", label: "Viewers" },
  { key: "editor", label: "Editors" },
  { key: "manager", label: "Managers" },
  { key: "admin", label: "Admins" },
] as const;

export function UserCountTiles() {
  const { data, isPending, isError } = useRoleCounts();

  return (
    <div className="flex flex-col gap-10">
      {isError ? (
        <Alert variant="error" title="Couldn’t load the headcounts">
          The list below is unaffected — retry to refresh the tiles.
        </Alert>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-12">
        {TILES.map((tile) => (
          <Card key={tile.key} className="flex flex-col gap-5 rounded-12 p-16">
            <span className="text-[13px] text-ink-muted">{tile.label}</span>
            <span
              className="text-[24px] font-semibold text-ink tabular-nums"
              data-testid={`role-count-${tile.key}`}
            >
              {isError ? (
                "—"
              ) : isPending || !data ? (
                <span
                  aria-hidden
                  className="inline-block h-[20px] w-[52px] rounded-4 bg-border-subtle align-[-2px]"
                />
              ) : (
                data[tile.key].toLocaleString("en-US")
              )}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}

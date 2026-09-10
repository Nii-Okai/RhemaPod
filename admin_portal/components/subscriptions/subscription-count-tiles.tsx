"use client";

import * as React from "react";

import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { useSubscriptionCounts } from "@/lib/query/hooks/use-subscriptions";

/* =============================================================================
   SubscriptionCountTiles — the three stat tiles on Subscriptions (Screen 9,
   W21). Same bare treatment as the W17 role-count tiles: a `minmax(180px,1fr)`
   auto-fit grid, gap 12; each card border/radius-12, padding 16 — a 13px
   ink-muted label over a 24/600 count.

   Active paid · Monthly · Annual, straight from
   `GET /admin/subscriptions/counts`. `active_paid` is the API's own number —
   `count_active_paid_subscribers`, the one definition already behind the
   analytics overview — it is NOT rendered as `monthly + annual`. There is no
   fourth tile, no delta, no "+N this month", no MRR, no dollar figure (plan
   decision 2, §A.3).

   Loading keeps the card geometry and swaps the number for a matched block; a
   failed aggregate shows one card-top alert, not three broken tiles.
   ========================================================================== */

const TILES = [
  { key: "active_paid", label: "Active paid" },
  { key: "monthly", label: "Monthly" },
  { key: "annual", label: "Annual" },
] as const;

export function SubscriptionCountTiles() {
  const { data, isPending, isError } = useSubscriptionCounts();

  return (
    <div className="flex flex-col gap-10">
      {isError ? (
        <Alert variant="error" title="Couldn’t load the counts">
          The list below is unaffected — retry to refresh the tiles.
        </Alert>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-12">
        {TILES.map((tile) => (
          <Card key={tile.key} className="flex flex-col gap-5 rounded-12 p-16">
            <span className="text-[13px] text-ink-muted">{tile.label}</span>
            <span
              className="text-[24px] font-semibold text-ink tabular-nums"
              data-testid={`subscription-count-${tile.key}`}
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

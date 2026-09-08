/**
 * `useCategories` — the "Category" option source on the editor's Details card
 * (W8). `GET /api/v1/categories` → `CategoryPublic[]` (no pagination on the
 * contract). Cached long — the list only changes from the Phase 2 Categories
 * screen.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type Category = components["schemas"]["CategoryPublic"];

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/categories", { signal })),
    staleTime: 5 * 60_000,
  });
}

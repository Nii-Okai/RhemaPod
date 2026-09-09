/**
 * Categories — read + write hooks.
 *
 *   useCategories()        GET    /api/v1/categories        → CategoryPublic[]
 *   useCreateCategory()    POST   /api/v1/categories        → CategoryPublic (201)
 *   useUpdateCategory()    PATCH  /api/v1/categories/{id}   → CategoryPublic
 *   useDeleteCategory()    DELETE /api/v1/categories/{id}   → 204
 *
 * `useCategories` is also the Category option source on the editor's Details
 * card (W8) and the Series form (W11) — cached long; the Speakers & categories
 * screen (W12) is the only editor.
 *
 * `slug` is **client-supplied** — the backend runs no slugify and rejects a
 * value that fails `^[a-z0-9]+(?:-[a-z0-9]+)*$` (422) or duplicates an existing
 * one (**409**). The 409 is surfaced inline on the slug field by the caller, not
 * as a card alert — so create is *not* optimistic (a rollback flash on the
 * common "slug taken" path is worse than a 150ms wait). Update and delete are
 * optimistic with rollback.
 *
 * A delete `SET NULL`s `sermon.category_id` (the "detaches, never deletes"
 * copy), so it also invalidates `sermons.lists()`.
 *
 * Backend gap → [GATE 3 Batch 5]: `CategoryPublic` carries no `sermon_count`;
 * the pill figure is an N+1 `limit=1` probe (`useEntityCount`).
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type Category = components["schemas"]["CategoryPublic"];
export type CategoryCreate = components["schemas"]["CategoryCreate"];
export type CategoryUpdate = components["schemas"]["CategoryUpdate"];

const listKey = queryKeys.categories.list();

export function useCategories() {
  return useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/categories", { signal })),
    staleTime: 5 * 60_000,
  });
}

function byName(a: Category, b: Category): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

interface ListContext {
  previous?: Category[];
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation<Category, Error, CategoryCreate>({
    mutationFn: (body) => unwrap(api.POST("/api/v1/categories", { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.categories.all() });
    },
  });
}

interface UpdateVars {
  id: string;
  patch: CategoryUpdate;
}

function mergeCategory(base: Category, patch: CategoryUpdate): Category {
  return {
    ...base,
    ...("name" in patch ? { name: patch.name ?? base.name } : {}),
    ...("slug" in patch ? { slug: patch.slug ?? base.slug } : {}),
  };
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation<Category, Error, UpdateVars, ListContext>({
    mutationFn: ({ id, patch }) =>
      unwrap(
        api.PATCH("/api/v1/categories/{category_id}", {
          params: { path: { category_id: id } },
          body: patch,
        }),
      ),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<Category[]>(listKey);
      if (previous) {
        qc.setQueryData<Category[]>(
          listKey,
          previous
            .map((c) => (c.id === id ? mergeCategory(c, patch) : c))
            .sort(byName),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(listKey, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.categories.all() });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation<void, Error, string, ListContext>({
    mutationFn: async (id) => {
      await api.DELETE("/api/v1/categories/{category_id}", {
        params: { path: { category_id: id } },
      });
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<Category[]>(listKey);
      if (previous) {
        qc.setQueryData<Category[]>(
          listKey,
          previous.filter((c) => c.id !== id),
        );
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(listKey, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.categories.all() });
      // `SET NULL` on `sermon.category_id` — list rows + count probes shift.
      void qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
    },
  });
}

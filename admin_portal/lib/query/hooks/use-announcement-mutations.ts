/**
 * Announcements editor CRUD hooks (W13).
 *
 *   useCreateAnnouncement()  POST   /api/v1/announcements       → AnnouncementAdminItem (201, draft)
 *   useUpdateAnnouncement()  PATCH  /api/v1/announcements/{id}  → AnnouncementAdminItem
 *
 * `update` is optimistic on the `announcements.list*` caches with rollback
 * (design §"Interactions" — optimistic edits, errors as a panel-top alert,
 * never a toast). This is where the plan's "pin toggle: optimistic" lands: a
 * PATCH that flips `pinned` re-renders the row's pinned dot immediately and
 * rolls back on failure. `create` is NOT optimistic — the panel needs the
 * server id before it can switch to edit mode.
 *
 * Deletes live on the row-menu surface (`use-announcement-workflow.ts`), not
 * here — the editor panel has no Delete control (design Screen 8). Both hooks
 * invalidate `announcements.lists()` on settle so every rendered page
 * reconciles against the server.
 */

"use client";

import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";
import type {
  AnnouncementAdminItem,
  AnnouncementAdminPage,
} from "@/lib/query/hooks/use-announcements";

export type AnnouncementCreate = components["schemas"]["AnnouncementCreate"];
export type AnnouncementUpdate = components["schemas"]["AnnouncementUpdate"];

function invalidateLists(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.announcements.lists() });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation<AnnouncementAdminItem, Error, AnnouncementCreate>({
    mutationFn: (body) => unwrap(api.POST("/api/v1/announcements", { body })),
    onSuccess: () => invalidateLists(qc),
  });
}

interface UpdateVars {
  announcementId: string;
  patch: AnnouncementUpdate;
}
type ListSnapshot = Array<
  [readonly unknown[], AnnouncementAdminPage | undefined]
>;
interface UpdateContext {
  snapshot: ListSnapshot;
}

function currentLists(qc: QueryClient): ListSnapshot {
  return qc.getQueriesData<AnnouncementAdminPage>({
    queryKey: queryKeys.announcements.lists(),
  }) as ListSnapshot;
}

/** Apply an `AnnouncementUpdate` onto a row for the optimistic cache write.
    Only keys the patch actually sets are touched; `title` / `body` never go
    `null` (the form never sends that), so a stray `null` falls back to the
    current value. */
function mergeRow(
  base: AnnouncementAdminItem,
  patch: AnnouncementUpdate,
): AnnouncementAdminItem {
  return {
    ...base,
    ...("title" in patch ? { title: patch.title ?? base.title } : {}),
    ...("description" in patch ? { description: patch.description ?? null } : {}),
    ...("body" in patch ? { body: patch.body ?? base.body } : {}),
    ...("pinned" in patch ? { pinned: patch.pinned ?? false } : {}),
    ...("publish_at" in patch ? { publish_at: patch.publish_at ?? null } : {}),
    ...("expires_at" in patch ? { expires_at: patch.expires_at ?? null } : {}),
  };
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient();
  return useMutation<AnnouncementAdminItem, Error, UpdateVars, UpdateContext>({
    mutationFn: ({ announcementId, patch }) =>
      unwrap(
        api.PATCH("/api/v1/announcements/{announcement_id}", {
          params: { path: { announcement_id: announcementId } },
          body: patch,
        }),
      ),
    onMutate: async ({ announcementId, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.announcements.lists() });
      const snapshot = currentLists(qc);
      for (const [key, data] of snapshot) {
        if (!data) continue;
        qc.setQueryData<AnnouncementAdminPage>(key, {
          ...data,
          items: data.items.map((row) =>
            row.id === announcementId ? mergeRow(row, patch) : row,
          ),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.snapshot) qc.setQueryData(key, data);
    },
    onSettled: () => invalidateLists(qc),
  });
}

/**
 * Speakers — read + write hooks.
 *
 *   useSpeakers()        GET    /api/v1/speakers          → SpeakerPublic[]
 *   useCreateSpeaker()   POST   /api/v1/speakers          → SpeakerPublic (201)
 *   useUpdateSpeaker()   PATCH  /api/v1/speakers/{id}     → SpeakerPublic
 *   useDeleteSpeaker()   DELETE /api/v1/speakers/{id}     → 204
 *
 * `useSpeakers` is also the "All speakers" option source on the Sermons list
 * (W7) and the editor's Details card (W8) — cached long; the Speakers &
 * categories screen (W12) is the only place that edits it.
 *
 * `GET /api/v1/speakers` returns the full `SpeakerPublic[]` (no pagination on
 * the contract), each row carrying its `sermon_count` (Batch 5) — the figure
 * the panel row and the delete-confirm copy read straight off the DTO. Create /
 * update / delete are optimistic on that one cached list with rollback (design
 * §"Interactions" — optimistic where cheap, errors as a card-top `<Alert>`,
 * never a toast). A delete `SET NULL`s `sermon.speaker_id`, so it also
 * invalidates `sermons.lists()` — that is what the "detaches it from N sermons"
 * copy refers to; the sermons themselves stay.
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type Speaker = components["schemas"]["SpeakerPublic"];
export type SpeakerCreate = components["schemas"]["SpeakerCreate"];
export type SpeakerUpdate = components["schemas"]["SpeakerUpdate"];

/** Prefix on the id of an optimistic-create row that has no server identity
    yet. Namespaced so a stray render of the temp row can't collide with a real
    UUID; the row is replaced wholesale by the `onSettled` refetch. */
export const OPTIMISTIC_ID_PREFIX = "optimistic:";

const listKey = queryKeys.speakers.list();

export function useSpeakers() {
  return useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/speakers", { signal })),
    staleTime: 5 * 60_000,
  });
}

/** Sort the way the panel renders — name, case-insensitive — so an optimistic
    insert lands where the server would put it and the row does not jump on
    refetch. */
function byName(a: Speaker, b: Speaker): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

interface ListContext {
  previous?: Speaker[];
}

export function useCreateSpeaker() {
  const qc = useQueryClient();
  return useMutation<Speaker, Error, SpeakerCreate, ListContext>({
    mutationFn: (body) => unwrap(api.POST("/api/v1/speakers", { body })),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<Speaker[]>(listKey);
      if (previous) {
        const optimistic: Speaker = {
          id: `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`,
          name: body.name,
          bio: body.bio ?? null,
          // No server row yet — the count arrives with the `onSettled` refetch.
          sermon_count: 0,
        };
        qc.setQueryData<Speaker[]>(
          listKey,
          [...previous, optimistic].sort(byName),
        );
      }
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context?.previous) qc.setQueryData(listKey, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.speakers.all() });
    },
  });
}

interface UpdateVars {
  id: string;
  patch: SpeakerUpdate;
}

function mergeSpeaker(base: Speaker, patch: SpeakerUpdate): Speaker {
  return {
    ...base,
    ...("name" in patch ? { name: patch.name ?? base.name } : {}),
    ...("bio" in patch ? { bio: patch.bio ?? null } : {}),
  };
}

export function useUpdateSpeaker() {
  const qc = useQueryClient();
  return useMutation<Speaker, Error, UpdateVars, ListContext>({
    mutationFn: ({ id, patch }) =>
      unwrap(
        api.PATCH("/api/v1/speakers/{speaker_id}", {
          params: { path: { speaker_id: id } },
          body: patch,
        }),
      ),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<Speaker[]>(listKey);
      if (previous) {
        qc.setQueryData<Speaker[]>(
          listKey,
          previous
            .map((s) => (s.id === id ? mergeSpeaker(s, patch) : s))
            .sort(byName),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(listKey, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.speakers.all() });
    },
  });
}

interface DeleteContext {
  /** The row this delete removed — re-inserted on failure. Rolling back only
      this id (not a whole-list snapshot) keeps a *concurrent* delete's own
      optimistic removal intact: a stale snapshot would resurrect the row the
      other delete already took out until the `onSettled` refetch healed it. */
  removed?: Speaker;
}

export function useDeleteSpeaker() {
  const qc = useQueryClient();
  return useMutation<void, Error, string, DeleteContext>({
    mutationFn: async (id) => {
      await api.DELETE("/api/v1/speakers/{speaker_id}", {
        params: { path: { speaker_id: id } },
      });
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: listKey });
      const current = qc.getQueryData<Speaker[]>(listKey);
      const removed = current?.find((s) => s.id === id);
      if (current) {
        qc.setQueryData<Speaker[]>(
          listKey,
          current.filter((s) => s.id !== id),
        );
      }
      return { removed };
    },
    onError: (_err, _id, context) => {
      const removed = context?.removed;
      if (!removed) return;
      qc.setQueryData<Speaker[]>(listKey, (current) => {
        const list = current ?? [];
        return list.some((s) => s.id === removed.id)
          ? list
          : [...list, removed].sort(byName);
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.speakers.all() });
      // The delete `SET NULL`s `sermon.speaker_id` — the sermon list rows
      // change (the sermons are not deleted).
      void qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
    },
  });
}

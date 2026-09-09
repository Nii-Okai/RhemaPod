/**
 * `useSermonStream` — signed playback URLs for the in-portal media player
 * (bugfix batch #11, the Review queue's "Watch" button).
 *
 * `GET /api/v1/sermons/{sermon_id}/stream` → `StreamResponse`:
 *   `{ expires_in, sermon_id, variants: [{ quality, type, url }] }`
 * where `type` is `"video" | "audio"`. The URLs are short-lived, so this is a
 * low-`staleTime` query fetched only while a player dialog is open (`enabled`).
 *
 * `loadSermonStream` is exported and client-injectable so the wire shape is
 * exercised through MSW rather than a mocked fetch (plan §A.11).
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type StreamResponse = components["schemas"]["StreamResponse"];
export type StreamVariant = components["schemas"]["StreamVariant"];

export async function loadSermonStream(
  sermonId: string,
  client: ApiClient = api,
): Promise<StreamResponse> {
  return unwrap(
    client.GET("/api/v1/sermons/{sermon_id}/stream", {
      params: { path: { sermon_id: sermonId } },
    }),
  );
}

/** The variant to play: prefer a video rendition, else the first one. */
export function pickPlaybackVariant(
  variants: readonly StreamVariant[],
): StreamVariant | null {
  if (variants.length === 0) return null;
  return variants.find((v) => v.type === "video") ?? variants[0];
}

export function useSermonStream(
  sermonId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.sermons.stream(sermonId ?? ""),
    queryFn: () => loadSermonStream(sermonId as string),
    enabled: Boolean(sermonId) && enabled,
    // The signed URLs expire; don't hand a stale one to a <video> minutes later.
    staleTime: 0,
    gcTime: 60_000,
  });
}

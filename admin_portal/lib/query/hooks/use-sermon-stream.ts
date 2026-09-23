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
  signal?: AbortSignal,
): Promise<StreamResponse> {
  return unwrap(
    client.GET("/api/v1/sermons/{sermon_id}/stream", {
      params: { path: { sermon_id: sermonId } },
      signal,
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

/**
 * How a `<video>`/`<audio>` element needs to be driven for a given URL.
 *
 * `_resolve_variant_url` (`app/services/media_service.py`) has exactly two
 * sources: a Cloudflare Stream signed playback URL — always
 * `.../manifest/video.m3u8` (`app/core/stream.py::signed_playback_url`, both
 * the stub and real providers) — or the pre-Stream presigned-S3 URL, which is
 * never an HLS manifest. Sniffing the `.m3u8` extension is therefore a
 * reliable discriminator without the backend adding an explicit field, and it
 * mirrors the backend's own "Stream vs. S3-fallback, invisible to the caller"
 * principle: the player picks the right strategy, the dialog doesn't have to
 * know which kind of URL it got.
 */
export type PlaybackKind = "hls" | "progressive";

export interface PlaybackSource {
  type: StreamVariant["type"];
  url: string;
  kind: PlaybackKind;
}

function isHlsUrl(url: string): boolean {
  const withoutQuery = url.split(/[?#]/, 1)[0];
  return withoutQuery.toLowerCase().endsWith(".m3u8");
}

/** Resolve a `StreamVariant` into a `PlaybackSource` the player can consume
 * without inspecting the URL itself. */
export function resolvePlaybackSource(
  variant: StreamVariant | null,
): PlaybackSource | null {
  if (!variant) return null;
  return {
    type: variant.type,
    url: variant.url,
    kind: isHlsUrl(variant.url) ? "hls" : "progressive",
  };
}

export function useSermonStream(
  sermonId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.sermons.stream(sermonId ?? ""),
    queryFn: ({ signal }) => loadSermonStream(sermonId as string, api, signal),
    enabled: Boolean(sermonId) && enabled,
    // The signed URLs expire; don't hand a stale one to a <video> minutes later.
    staleTime: 0,
    gcTime: 60_000,
  });
}

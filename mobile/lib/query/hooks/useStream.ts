import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type StreamResponse = components['schemas']['StreamResponse'];
export type StreamVariant = components['schemas']['StreamVariant'];

/**
 * `GET /api/v1/sermons/{sermon_id}/stream` (unprefixed `/sermons/{sermon_id}/stream` —
 * this operation lives outside `/catalog`, see `app/api/media.py`) — one signed
 * playback-URL variant per `MediaRef` on the sermon (video and/or audio), unfiltered.
 * `OptionalUser`-gated on the backend but this app never calls it signed-out (L2).
 *
 * Deliberately not long-lived cache: the URL itself expires server-side
 * (`expires_in`, ~6h default, `settings.stream_url_expire_seconds`) well past any single
 * playback session, so the default query staleness is fine — a remount fetching a fresh
 * signed URL is harmless, not a sign of over-fetching.
 */
export function useStream(sermonId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.stream.detail(sermonId),
    queryFn: ({ signal }) =>
      api.get('/sermons/{sermon_id}/stream', { params: { path: { sermon_id: sermonId } }, init: { signal } }),
    enabled: options.enabled ?? true,
  });
}

/** The playable variant this app's player uses: video first (per `hasVideo` elsewhere — a
 * sermon with both renditions plays its video), else the audio rendition. `null` when
 * neither is present (shouldn't happen past `isPlayable`'s own gate, but the player
 * checks anyway rather than assuming). */
export function selectPlaybackVariant(variants: StreamVariant[]): StreamVariant | null {
  return variants.find((v) => v.type === 'video') ?? variants.find((v) => v.type === 'audio') ?? null;
}

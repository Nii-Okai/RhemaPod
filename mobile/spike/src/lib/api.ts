import { apiUrl, TEST_SERMON_ID } from './env';

export class SpikeApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SpikeApiError';
  }
}

export interface StreamVariant {
  type: 'video' | 'audio';
  quality: string | null;
  url: string;
}

export interface StreamResponse {
  sermon_id: string;
  expires_in: number;
  variants: StreamVariant[];
}

export interface AudioDownloadResponse {
  sermon_id: string;
  url: string;
  expires_in: number;
}

/**
 * True Cloudflare Stream URLs are always served from
 * `customer-<subdomain>.cloudflarestream.com` (`app/core/stream.py`'s
 * `CloudflareStream.signed_playback_url`). Anything else reaching this
 * client is the presigned-S3 fallback path
 * (`media_service._resolve_variant_url`) — e.g. because
 * `CF_STREAM_SIGNING_KEY_ID`/`_PEM` isn't set yet, per the dispatch's own
 * note that this is expected until Isaac mints the signing key. This is the
 * one heuristic the whole item-1 check hangs on, so it lives here, next to
 * the fetch, not buried in a screen component.
 */
export function classifyStreamUrl(url: string): 'cloudflare-stream' | 's3-fallback' {
  return url.includes('.cloudflarestream.com') ? 'cloudflare-stream' : 's3-fallback';
}

async function request<T>(path: string): Promise<T> {
  if (!TEST_SERMON_ID) {
    throw new SpikeApiError(
      'EXPO_PUBLIC_TEST_SERMON_ID is not set — copy .env.example to .env and fill in the ' +
        'W0.1 test sermon UUID (see mobile/spike/README.md).',
    );
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path));
  } catch (err) {
    throw new SpikeApiError(
      `Network error reaching ${apiUrl(path)} — is the backend running and reachable from ` +
        `this device/emulator? (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SpikeApiError(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as T;
}

export function getStream(): Promise<StreamResponse> {
  return request<StreamResponse>(`/sermons/${TEST_SERMON_ID}/stream`);
}

export function getAudioDownload(): Promise<AudioDownloadResponse> {
  return request<AudioDownloadResponse>(`/sermons/${TEST_SERMON_ID}/download/audio`);
}

import type { MediaLoadRequest } from 'react-native-google-cast';
import type { StreamVariant } from '../query/hooks/useStream';

/** What to put on the TV: a sermon, how to label it there, and where to start. */
export interface CastMedia {
  sermonId: string;
  title: string;
  /** Second line on the TV — the series or speaker. */
  subtitle?: string | null;
  imageUrl?: string | null;
  /** Seconds in; omitted or 0 starts from the top. */
  startTime?: number;
}

const CONTENT_TYPES: Record<string, string> = {
  m3u8: 'application/x-mpegurl',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
};

/**
 * The receiver needs a MIME type to pick its player. `/stream` hands back either a
 * Cloudflare Stream HLS manifest or a presigned file URL (`media_service`'s
 * `_resolve_variant_url`), so the path's extension names it; the query string (the
 * signature) is ignored. An unknown extension falls back by rendition type.
 */
export function contentTypeFor(variant: Pick<StreamVariant, 'url' | 'type'>): string {
  const path = variant.url.split(/[?#]/)[0];
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? (variant.type === 'audio' ? 'audio/mpeg' : 'video/mp4');
}

/**
 * The load request for Google's Default Media Receiver: the signed playback URL the
 * phone's own player would use, labelled with the sermon's title and art.
 */
export function buildCastRequest(media: CastMedia, variant: Pick<StreamVariant, 'url' | 'type'>): MediaLoadRequest {
  return {
    autoplay: true,
    startTime: media.startTime && media.startTime > 0 ? media.startTime : undefined,
    mediaInfo: {
      contentId: media.sermonId,
      contentUrl: variant.url,
      contentType: contentTypeFor(variant),
      metadata: {
        type: 'generic',
        title: media.title,
        subtitle: media.subtitle ?? undefined,
        images: media.imageUrl ? [{ url: media.imageUrl }] : undefined,
      },
    },
  };
}

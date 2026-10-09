import * as FileSystem from 'expo-file-system';
import Share from 'react-native-share';

/**
 * Rich share (Isaac's ask, session 2026-10-09: "include image thumbnail, title,
 * description and link") for sermon/series detail's own Share action. Core React
 * Native's `Share` API can't do this: it has no image-attachment support on Android at
 * all, and even on iOS a remote `https://` URL in its `url` field is shared as a plain
 * link, not fetched and attached as an image. `react-native-share` (a new native
 * dependency, flagged per Isaac's own ask when confirming this approach) is the
 * standard fix — its `url` field DOES attach a local `file://`/base64 image on both
 * platforms, alongside `message`'s text, in one native share sheet.
 *
 * The link shared is the app's own `rhemapod://` deep link (Isaac's call, same
 * session) — it opens the right screen for someone who already has the app installed,
 * and currently does nothing for someone who doesn't, since there is no web page for a
 * sermon/series to fall back to yet.
 */
export interface ShareableContent {
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  /** e.g. `sermon/<id>` or `series/<id>` — joined onto the app's own `rhemapod://` scheme. */
  deepLinkPath: string;
}

const DESCRIPTION_MAX_LENGTH = 200;
const SCHEME = 'rhemapod://';

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

function composeMessage({ title, description, deepLinkPath }: ShareableContent): string {
  const parts = [title];
  if (description) parts.push(truncate(description, DESCRIPTION_MAX_LENGTH));
  parts.push(`${SCHEME}${deepLinkPath}`);
  return parts.join('\n\n');
}

/** Best-effort: a thumbnail that fails to download just means the share goes out as
 * text-only (title/description/link), never blocks or fails the whole share over an
 * image fetch hiccup. */
async function downloadThumbnail(url: string): Promise<string | null> {
  try {
    const extension = (url.split('?')[0]?.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
    const dest = `${FileSystem.cacheDirectory}share-${Date.now()}.${extension}`;
    const result = await FileSystem.downloadAsync(url, dest);
    return result.status === 200 ? result.uri : null;
  } catch {
    return null;
  }
}

export async function shareContent(content: ShareableContent): Promise<void> {
  const message = composeMessage(content);
  const localImageUri = content.thumbnailUrl ? await downloadThumbnail(content.thumbnailUrl) : null;

  try {
    await Share.open({
      title: content.title,
      message,
      url: localImageUri ?? undefined,
      // The library rejects on a plain user-cancelled dismissal by default — that's
      // not a failure this app needs to surface (no caller here treats share
      // rejection as an error to show).
      failOnCancel: false,
    });
  } finally {
    if (localImageUri) {
      await FileSystem.deleteAsync(localImageUri, { idempotent: true }).catch(() => undefined);
    }
  }
}

import Share from 'react-native-share';
import { SHARE_BASE_URL } from '../api/config';

/**
 * Share for sermon/series/playlist detail's own Share action: the title, a truncated
 * description and an `https://open.rhemapod.com/<type>/<id>` link, as text through the
 * native share sheet (`react-native-share`; core React Native's `Share` can't be used on
 * Android with a `title`, and the app already depends on this one).
 *
 * The link is the https share link (ADR 0021): messengers make it tappable, it opens the
 * app when installed (Universal/App Links) and a static store page when not. No image is
 * attached — with a bare link, messengers render their own link card (Isaac's call at
 * plan-share-links SL0, reversing the 2026-10-09 "include image thumbnail" ask). The base
 * is `EXPO_PUBLIC_SHARE_BASE_URL`, read by `SHARE_BASE_URL` in `lib/api/config.ts`.
 */
export interface ShareableContent {
  title: string;
  description?: string | null;
  /** e.g. `sermon/<id>`, `series/<id>` or `playlist/<id>` — joined onto the share base. */
  deepLinkPath: string;
}

const DESCRIPTION_MAX_LENGTH = 200;

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const head = trimmed.slice(0, maxLength);
  const lastSpace = head.lastIndexOf(' ');
  // Cut at the last space so a word isn't split; a single unbroken run is hard-cut.
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

function composeMessage({ title, description, deepLinkPath }: ShareableContent): string {
  const parts = [title];
  if (description) parts.push(truncate(description, DESCRIPTION_MAX_LENGTH));
  // Label, newline, then the bare URL alone on its line so messengers linkify it cleanly.
  parts.push(`Listen on RhemaPod:\n${SHARE_BASE_URL}/${deepLinkPath.replace(/^\/+/, '')}`);
  return parts.join('\n\n');
}

export async function shareContent(content: ShareableContent): Promise<void> {
  await Share.open({
    title: content.title,
    message: composeMessage(content),
    // The library rejects on a plain user-cancelled dismissal by default — that's
    // not a failure this app needs to surface (no caller here treats share
    // rejection as an error to show).
    failOnCancel: false,
  });
}

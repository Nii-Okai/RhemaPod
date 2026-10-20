/**
 * `GET /settings/public` — the church's contact email, comment guidelines and legal links,
 * editable by staff in the admin portal (plan-admin-settings S18, ADR 0017). Public read:
 * no auth on the endpoint, so it works signed out.
 *
 * The app must never depend on it. `useChurchContent()` always returns usable values:
 * the server's when it has them (live, or restored from the persisted query cache), and
 * otherwise the constants shipped in `lib/content/commentsCompliance.ts` — on first launch
 * with no network, on any error, or while loading. Those constants are also what App
 * Store guideline 1.2 relies on for offline contact info, so they stay.
 *
 * The data changes rarely (a staff edit), so it is treated as fresh for an hour and kept
 * in the persisted cache like other catalogue reads. Legal links are only surfaced when
 * they are absolute `https` URLs — the server already enforces that; checking again here
 * means a bad value can never become an `openURL` for some other scheme.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';
import { COMMENTS_TERMS_TEXT, CONTACT_EMAIL } from '../../content/commentsCompliance';

export type ChurchSettingsPublic = components['schemas']['ChurchSettingsPublic'];

const ONE_HOUR_MS = 60 * 60 * 1000;

export function useChurchSettings() {
  return useQuery({
    queryKey: queryKeys.settings.public(),
    queryFn: ({ signal }) => api.get('/settings/public', { init: { signal } }),
    staleTime: ONE_HOUR_MS,
  });
}

// `https://` + a non-empty host, then optionally a path/query/fragment; no whitespace or
// control characters anywhere. A pattern, not `new URL()`: React Native's built-in URL
// throws "not implemented" from `protocol`/`hostname`, so a URL-based check would reject
// every link on a real device while passing under Jest's Node URL.
const HTTPS_URL = /^https:\/\/[^\s/?#@\\]+(?:[/?#][^\s]*)?$/i;

/** `url` if it is an absolute https URL, else `null`. */
export function safeHttpsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(url)) return null;
  return HTTPS_URL.test(url) ? url : null;
}

export interface ChurchContent {
  contactEmail: string;
  commentGuidelines: string;
  termsOfUseUrl: string | null;
  privacyPolicyUrl: string | null;
}

/** Server values with the shipped constants as fallback (see module comment). */
export function churchContentFrom(settings: ChurchSettingsPublic | undefined): ChurchContent {
  return {
    contactEmail: settings?.contact_email || CONTACT_EMAIL,
    commentGuidelines: settings?.comment_guidelines || COMMENTS_TERMS_TEXT,
    termsOfUseUrl: safeHttpsUrl(settings?.terms_of_use_url),
    privacyPolicyUrl: safeHttpsUrl(settings?.privacy_policy_url),
  };
}

export function useChurchContent(): ChurchContent {
  const { data } = useChurchSettings();
  return churchContentFrom(data);
}

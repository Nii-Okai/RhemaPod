import { ApiError } from '../../../lib/api/errors';

export type SocialProvider = 'google' | 'apple';

/** Matches sign-in.tsx's own retry-window copy for the email/password 429 case (and the
 * admin portal login form's, login-form.tsx) — shared here so the new Google/Apple 429
 * case renders identical copy instead of a second hand-written version. */
export function retryWindowText(retryAfter: string | null): string {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds < 90) return `Try again in about ${seconds} seconds.`;
    return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  }
  return 'Wait a minute or so, then try again.';
}

export interface SocialAuthErrorCopy {
  title: string;
  detail?: string;
}

/**
 * Maps a `POST /auth/oauth/google`/`/auth/oauth/apple` failure to the same
 * title+detail `InlineAlert` shape sign-in.tsx's own email/password errors already use.
 * The backend's own `detail` strings (e.g. "Invalid or expired sign-in token", "This
 * account is already linked to a different Google account") are shown verbatim as the
 * alert's detail text — there's no friendlier rewrite needed, they're already
 * user-facing copy by design.
 */
export function socialAuthErrorCopy(error: unknown, provider: SocialProvider): SocialAuthErrorCopy {
  const providerLabel = provider === 'google' ? 'Google' : 'Apple';

  if (error instanceof ApiError) {
    if (error.status === 404) {
      // The provider is disabled server-side (e.g. `oauth_apple_enabled` not yet
      // flipped on) — a plain unavailability message, not a generic failure.
      return { title: `${providerLabel} sign-in isn't available right now` };
    }
    if (error.status === 429) {
      return { title: 'Too many sign-in attempts', detail: retryWindowText(error.retryAfter) };
    }
    return { title: `Could not sign you in with ${providerLabel}`, detail: error.message };
  }

  return { title: `Could not sign you in with ${providerLabel}`, detail: 'Something went wrong. Try again.' };
}

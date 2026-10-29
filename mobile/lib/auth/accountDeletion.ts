import { api } from '../api/typedClient';
import { ApiError } from '../api/errors';
import type { components } from '../api/schema';

/**
 * Self-service account deletion, client side (ADR 0020; plans/plan-account-deletion-clients.md
 * D12). `POST /auth/me/delete` takes one fresh proof in the same request and answers 204. This
 * module owns the two decisions the screen needs and nothing else: which proof to ask for, and
 * what each error means. No UI, so it is unit-tested on its own.
 */

export type DeletionMethod = 'apple' | 'password' | 'google';
export type AccountDeletionRequest =
  | components['schemas']['PasswordDeletionRequest']
  | components['schemas']['GoogleDeletionRequest']
  | components['schemas']['AppleDeletionRequest'];

type Profile = Pick<components['schemas']['UserPublic'], 'has_password' | 'linked_providers'>;

export interface ReauthPlan {
  appleLinked: boolean;
  /** The proof to ask for first. `null`: no proof this device can give (an Apple-only account
   * on Android), so the only route is support. */
  primary: DeletionMethod | null;
  /** Non-Apple proofs the account has, in preference order. With Apple linked these are what
   * the `apple_unavailable` fallback uses. */
  nonApple: DeletionMethod[];
  /** Apple is linked but this device can't re-auth with Apple (Android), so the request must
   * carry `apple_unavailable: true` from the start and the user revokes Apple by hand. */
  skipAppleFromStart: boolean;
}

/**
 * The server requires a fresh Apple proof whenever Apple is linked (that is what lets it revoke
 * the grant), and accepts `apple_unavailable` only alongside a non-Apple proof. So: Apple first
 * when the device can do it, else password, else Google.
 */
export function planReauth(profile: Profile, appleAvailable: boolean): ReauthPlan {
  const linked = profile.linked_providers ?? [];
  const appleLinked = linked.includes('apple');
  const nonApple: DeletionMethod[] = [];
  if (profile.has_password) nonApple.push('password');
  if (linked.includes('google')) nonApple.push('google');

  if (appleLinked && appleAvailable) {
    return { appleLinked, primary: 'apple', nonApple, skipAppleFromStart: false };
  }
  return {
    appleLinked,
    primary: nonApple[0] ?? null,
    nonApple,
    skipAppleFromStart: appleLinked,
  };
}

/** Exact backend detail (`APPLE_UNAVAILABLE_MESSAGE`) that marks a 503 as "Apple didn't answer".
 * Other 503s (rate-limit store, sign-in or deletion temporarily unavailable) share the status. */
export const APPLE_UNAVAILABLE_DETAIL = 'Apple is unavailable right now. Try again shortly.';

/** Consecutive Apple 503s before the screen offers deleting without revoking Apple. */
export const APPLE_FAILURES_BEFORE_FALLBACK = 2;

export function deleteAccount(body: AccountDeletionRequest): Promise<void> {
  return api.post('/auth/me/delete', { body }) as Promise<void>;
}

export type DeletionErrorKind =
  /** 403: the proof didn't check out. Never a sign-out: the session is still valid. */
  | 'reauth'
  /** 400: the proof was rejected as malformed (on the Apple path: expired or reused code). */
  | 'badRequest'
  /** 503 on the Apple path: Apple didn't answer. Nothing was deleted. */
  | 'appleUnavailable'
  /** 409: the account needs Apple, or support (Apple-only, authored content). */
  | 'conflict'
  | 'rateLimited'
  | 'network'
  | 'generic';

export interface DeletionError {
  kind: DeletionErrorKind;
  message: string;
}

const REAUTH_MESSAGE = "We couldn't confirm it's you. Check your password, or sign in again, and retry.";

export function deletionErrorFor(err: unknown, method: DeletionMethod): DeletionError {
  if (!(err instanceof ApiError)) return { kind: 'generic', message: 'Something went wrong. Try again.' };
  if (err.network) return { kind: 'network', message: err.message };
  switch (err.status) {
    case 400:
      return { kind: 'badRequest', message: err.message };
    case 403:
      return { kind: 'reauth', message: REAUTH_MESSAGE };
    case 409:
      return { kind: 'conflict', message: err.message };
    case 429:
      return { kind: 'rateLimited', message: err.message };
    case 503:
      // The same status covers other outages; only Apple's own detail counts toward the
      // fallback offer.
      return method === 'apple' && err.message === APPLE_UNAVAILABLE_DETAIL
        ? { kind: 'appleUnavailable', message: err.message }
        : { kind: 'generic', message: err.message };
    default:
      return { kind: 'generic', message: err.message };
  }
}

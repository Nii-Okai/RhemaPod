import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

/**
 * Apple Sign-In (client side, session 2026-10-15) — only ever offered on iOS (App Store
 * guideline 4.8 is an iOS-only rule, and the native module doesn't work on Android
 * either). Isaac hasn't enrolled in the paid Apple Developer Program yet, so the native
 * call will likely fail with no "Sign In with Apple" capability provisioned on a real
 * device right now; that failure is handled the same plain way as any other sign-in
 * failure, no special-casing, so this starts working with zero code changes once he
 * enrolls.
 */

export interface AppleSignInResult {
  identityToken: string;
  /** The pre-digest nonce — sent to the backend as `raw_nonce`. Do not confuse with the
   * SHA-256 digest that goes to Apple's own `nonce` param (see `performAppleSignIn`). */
  rawNonce: string;
  authorizationCode: string | null;
  /** Only ever present on the very first authorization for this Apple ID on this
   * device — `null` on every repeat sign-in, not an error condition. */
  givenName: string | null;
  familyName: string | null;
}

function randomNonce(byteCount = 32): string {
  const bytes = Crypto.getRandomBytes(byteCount);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isCancellation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ERR_REQUEST_CANCELED'
  );
}

/**
 * Runs the native "Sign in with Apple" sheet and returns everything
 * `session.signInWithApple` needs to call `POST /auth/oauth/apple`, or `null` if the
 * user tapped Cancel on Apple's own sheet — a silent no-op, not an error, the standard
 * platform convention every app follows for Apple's own cancel button.
 *
 * Nonce handling — getting raw vs. digest backwards here silently breaks backend
 * verification: a random string is generated locally (`rawNonce`) and its SHA-256
 * **digest** is sent to Apple as the `nonce` param; the backend independently hashes the
 * **raw** nonce this function returns as `rawNonce` and checks it matches the digest
 * baked into the identity token's own `nonce` claim.
 */
export async function performAppleSignIn(): Promise<AppleSignInResult | null> {
  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (err) {
    if (isCancellation(err)) return null;
    throw err;
  }

  if (!credential.identityToken) {
    throw new Error('Apple sign-in did not return an identity token.');
  }

  return {
    identityToken: credential.identityToken,
    rawNonce,
    authorizationCode: credential.authorizationCode,
    givenName: credential.fullName?.givenName ?? null,
    familyName: credential.fullName?.familyName ?? null,
  };
}

/**
 * Whether the Apple Sign-In button should render at all (Isaac's decision #3): a cheap
 * `Platform.OS === 'ios'` gate first, before even calling anything Apple-specific, then
 * the module's own `isAvailableAsync()` check. Defaults to `false` (not shown) until
 * that resolves, rather than flashing the button then hiding it.
 */
export function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    void AppleAuthentication.isAvailableAsync().then((result) => {
      if (!cancelled) setAvailable(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}

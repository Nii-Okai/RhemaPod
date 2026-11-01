import { Platform } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

/**
 * Google Sign-In (client side, session 2026-10-15). Uses the library's free "Original"
 * API (not the Firebase-backed one) — the architect's call, not relitigated here.
 * `webClientId`/`iosClientId` come from `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` /
 * `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (`.env.example`), placeholders until Isaac supplies
 * the real Google Cloud Console OAuth client IDs — see `.env.example`'s own comment.
 */

let configured = false;

/**
 * Configures the native module once per process. Must run before the first
 * `GoogleSignin.signIn()` call — called from `AuthContext.tsx`'s mount effect, the same
 * place `session.bootstrap()` runs, so every entry point that can reach a sign-in or
 * register screen has already configured it.
 */
export function configureGoogleSignIn(): void {
  if (configured) return;
  configured = true;
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    // Android sends a one-time server auth code (the backend exchanges it) instead of an
    // ID token: Play Services re-serves a cached ID token, which our single-use replay
    // protection rejects. `forceCodeForRefreshToken: false` keeps the consent screen to
    // the first sign-in only. iOS keeps sending the ID token. See ADR 0015 addendum.
    ...(Platform.OS === 'android' ? { offlineAccess: true, forceCodeForRefreshToken: false } : {}),
  });
}

/** What the backend's `POST /auth/oauth/google` (and the deletion Google proof) accepts: exactly one. */
export type GoogleCredential =
  | { kind: 'id_token'; idToken: string }
  | { kind: 'server_auth_code'; code: string };

/**
 * Runs the native Google sign-in sheet and returns the credential to send the backend, or
 * `null` if the user dismissed the sheet (a silent no-op, like Apple's cancel). Android
 * returns the one-time `serverAuthCode`; iOS returns the ID token.
 *
 * Throws if the native call succeeds but the platform's credential is missing; the
 * caller surfaces it through the generic sign-in error path. On Android that means
 * `offlineAccess`/`webClientId` are misconfigured. There is no fallback to the ID token.
 */
export async function performGoogleSignIn(): Promise<GoogleCredential | null> {
  // `showPlayServicesUpdateDialog` must be passed explicitly; the library throws in
  // non-production builds if it's omitted. No-ops to `true` on iOS.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') return null;

  if (Platform.OS === 'android') {
    const code = response.data.serverAuthCode;
    if (!code) {
      throw new Error(
        "Google sign-in did not return a server auth code. Check GoogleSignin.configure's webClientId and offlineAccess.",
      );
    }
    return { kind: 'server_auth_code', code };
  }

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error("Google sign-in did not return an ID token. Check GoogleSignin.configure's client IDs.");
  }
  return { kind: 'id_token', idToken };
}

/**
 * Drops the app's Google grant and cached Google session on this device (account deletion
 * only). On Android, `revokeAccess()` only works while the SDK knows the current account,
 * so restore it silently first. Every step is best-effort: there may be no Google session.
 */
async function dropGoogleGrant(): Promise<void> {
  try {
    if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signInSilently();
  } catch {
    // No restorable session.
  }
  try {
    await GoogleSignin.revokeAccess();
  } catch {
    // Nothing to revoke.
  }
  try {
    await GoogleSignin.signOut();
  } catch {
    // Already signed out.
  }
}

/** App sign-out: clear the cached Google account so the picker shows next time. No revoke. */
export async function signOutGoogle(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Already signed out.
  }
}

/** After account deletion: revoke the app's grant and forget the Google account on this device. */
export async function forgetGoogleAccount(): Promise<void> {
  await dropGoogleGrant();
}

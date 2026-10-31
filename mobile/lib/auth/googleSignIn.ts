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
  });
}

/**
 * Runs the native Google sign-in sheet and returns the ID token to send the backend
 * (`POST /auth/oauth/google`), or `null` if the user dismissed the native sheet — a
 * silent no-op, not an error, the same convention Apple's own cancel button gets
 * (`appleSignIn.ts`).
 *
 * Throws if the native call succeeds but no `idToken` comes back — this is the expected
 * state while `GoogleSignin.configure`'s `webClientId` is still the dev placeholder
 * rather than a real Google Cloud Console value, not a crash; the caller surfaces it
 * through the same generic error path as any other sign-in failure.
 */
export async function performGoogleSignIn(): Promise<string | null> {
  // Android-only check; the library's own `hasPlayServices` no-ops to `true` on iOS
  // without touching the native side at all (confirmed in its own `GoogleSignin.ts`
  // source, not assumed). `showPlayServicesUpdateDialog` must be passed explicitly — the
  // library throws in non-production builds if it's omitted.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // Our backend treats every Google ID token as single-use (replay protection, by
  // design — see ADR 0015). On Android, Play Services hands back the same cached ID
  // token until the app's grant is revoked, so drop it first. See dropGoogleGrant.
  await dropGoogleGrant();

  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') return null;

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error("Google sign-in did not return an ID token. Check GoogleSignin.configure's client IDs.");
  }
  return idToken;
}

/**
 * Drops the app's Google grant and cached Google session on this device so the next
 * `signIn()` returns a genuinely fresh ID token. On Android, `revokeAccess()` only works
 * while the SDK knows the current account, which it forgets across app restarts and our
 * own sign-out — so restore it silently first (confirmed on-device 2026-10-31: without
 * this, `revokeAccess()` threw, was swallowed, and the backend rejected the reused token
 * as replayed). Every step is best-effort: there may be no Google session at all.
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

/** After sign-out or account deletion: forget the Google account on this device. */
export async function forgetGoogleAccount(): Promise<void> {
  await dropGoogleGrant();
}

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { clearPendingLink, takePendingLink } from '../linking/pendingLink';
import { configureGoogleSignIn } from './googleSignIn';
import * as session from './session';
import type { AuthStatus } from './types';

interface AuthContextValue {
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<{ message: string }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<{ message: string }>;
  signOut: () => Promise<void>;
  /** Local teardown after the server deleted the account (`session.finishAccountDeletion`). */
  finishAccountDeletion: () => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signInWithApple: (
    identityToken: string,
    rawNonce: string,
    authorizationCode: string | null,
    givenName: string | null,
    familyName: string | null,
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Thin React mirror of `session.ts`'s module-level status, for screens and
 * the root layout's redirect. `session.ts` itself has no React dependency —
 * `lib/api/client.ts` reads/refreshes it directly without going through
 * this provider.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(session.getStatus());
  const previousStatus = useRef(status);

  useEffect(() => {
    // One-time native setup, same spirit as `QueryProvider`/this effect's own
    // `session.bootstrap()` call — not scattered at each `SocialSignInButton`'s own
    // press handler.
    configureGoogleSignIn();
    const unsubscribe = session.subscribe(setStatus);
    void session.bootstrap();
    return unsubscribe;
  }, []);

  // Any sign-out (user-initiated, forced by a failed refresh, or account deletion) drops a
  // stashed shared link — it belonged to the session that just ended.
  useEffect(() => {
    if (previousStatus.current === 'signedIn' && status === 'signedOut') clearPendingLink();
    previousStatus.current = status;
  }, [status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      signIn: session.signIn,
      register: session.register,
      forgotPassword: session.forgotPassword,
      verifyEmail: session.verifyEmail,
      resendVerification: session.resendVerification,
      signOut: session.signOut,
      finishAccountDeletion: session.finishAccountDeletion,
      signInWithGoogle: session.signInWithGoogle,
      signInWithApple: session.signInWithApple,
    }),
    [status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/**
 * Root-route auth guard (plan L2 — "no anonymous browsing, no content
 * preview"). The `(tabs)` group is where real app content lives; a
 * signed-out session is bounced to sign-in from there (covers both the
 * initial `/` redirect via `app/index.tsx` and any deep link straight into a
 * tab). A signed-in session sitting on an `(auth)` screen (e.g. after
 * backgrounding mid-flow) is sent forward into the app instead.
 *
 * A shared link stashed while signed out (or at cold start) is replayed here, once, as
 * soon as a signed-in user is on the home tabs — after any sign-in method — so the stack
 * is home -> target.
 */
export function useAuthGuard(): void {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const inTabsGroup = segments[0] === '(tabs)';
    const inAuthGroup = segments[0] === '(auth)';

    if (status === 'signedOut' && inTabsGroup) {
      router.replace('/(auth)/sign-in');
    } else if (status === 'signedIn' && inAuthGroup) {
      router.replace('/(tabs)/home');
    } else if (status === 'signedIn' && inTabsGroup) {
      const pendingRoute = takePendingLink();
      if (pendingRoute) router.push(pendingRoute);
    }
  }, [status, segments, router]);
}

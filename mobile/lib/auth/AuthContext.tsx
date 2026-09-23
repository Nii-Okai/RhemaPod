import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter, useSegments } from 'expo-router';
import * as session from './session';
import type { AuthStatus } from './types';

interface AuthContextValue {
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<{ message: string }>;
  signOut: () => Promise<void>;
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

  useEffect(() => {
    const unsubscribe = session.subscribe(setStatus);
    void session.bootstrap();
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      signIn: session.signIn,
      register: session.register,
      forgotPassword: session.forgotPassword,
      signOut: session.signOut,
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
    }
  }, [status, segments, router]);
}

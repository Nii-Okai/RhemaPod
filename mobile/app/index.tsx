import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth/AuthContext';
import { hasSeenOnboarding } from '../lib/settings/onboardingSeen';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';

/**
 * The app's root route (plan L2). No content preview: an unauthenticated
 * device is sent straight to sign-in, full stop. `useAuthGuard`
 * (`lib/auth/AuthContext.tsx`, wired in `app/_layout.tsx`) covers deep links
 * straight into `(tabs)`; this covers the plain `/` case, including the
 * brief `bootstrap()` window where status is still `loading`.
 *
 * First-launch onboarding (`app/onboarding.tsx`) sits ahead of that redirect: on a fresh
 * install `hasSeenOnboarding()` resolves `false` before any account is known, so this
 * goes to `/onboarding` regardless of `status`. The loading spinner now covers both
 * async checks — it stays up until `status` AND the onboarding-seen lookup have both
 * resolved, so neither check jumps the gun on the other.
 */
export default function Index() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { status } = useAuth();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hasSeenOnboarding().then((seen) => {
      if (cancelled) return;
      setOnboardingSeen(seen);
      setOnboardingChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading' || !onboardingChecked) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent.gold} />
      </View>
    );
  }

  if (!onboardingSeen) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href={status === 'signedIn' ? '/(tabs)/home' : '/(auth)/sign-in'} />;
}

const useStyles = createThemedStyles((colors) => ({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.app,
  },
}));

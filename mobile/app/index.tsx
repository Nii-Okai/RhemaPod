import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth/AuthContext';
import { colors } from '../theme/colors';

/**
 * The app's root route (plan L2). No content preview: an unauthenticated
 * device is sent straight to sign-in, full stop. `useAuthGuard`
 * (`lib/auth/AuthContext.tsx`, wired in `app/_layout.tsx`) covers deep links
 * straight into `(tabs)`; this covers the plain `/` case, including the
 * brief `bootstrap()` window where status is still `loading`.
 */
export default function Index() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent.gold} />
      </View>
    );
  }

  return <Redirect href={status === 'signedIn' ? '/(tabs)/home' : '/(auth)/sign-in'} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.app,
  },
});

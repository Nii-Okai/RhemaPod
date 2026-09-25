import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuthGuard } from '../lib/auth/AuthContext';
import { QueryProvider } from '../lib/query/QueryProvider';

function RootNavigator() {
  useAuthGuard();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* W4.3 — top-level stack routes outside the tab chrome (plan L15/§A.7):
          identical on every platform, reached from search results and the
          Browse category/speaker drill-down lists. */}
      <Stack.Screen name="sermon/[id]" options={{ title: '' }} />
      <Stack.Screen name="category/[id]" />
      <Stack.Screen name="speaker/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}

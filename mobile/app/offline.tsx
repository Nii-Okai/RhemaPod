import React, { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleButton } from '../components';
import { OfflineState } from '../components/offline';
import { createThemedStyles } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import { useIsOnline } from '../lib/hooks/useIsOnline';

/**
 * "You're offline" (offline mockups, Nii 2026-11-22). Every offline placeholder in the app
 * opens this page: it explains what's wrong, opens the phone's settings, and points to
 * downloads. It closes itself once the connection comes back, so whatever was behind it
 * reloads in place. On an iPad or Android tablet the column stays centred and narrow.
 */
export default function OfflineScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const wasOffline = useRef(false);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  useEffect(() => {
    if (!online) wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      close();
    }
  }, [online]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
        <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={close} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <OfflineState onReconnected={close} />
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
  },
}));

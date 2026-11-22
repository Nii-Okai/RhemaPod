import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Network from 'expo-network';
import { useQueryClient } from '@tanstack/react-query';
import { AppText } from '../Text';
import { LinkButton, PrimaryButton } from '../Button';
import { PlatformIcon } from '../PlatformIcon';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { pathnameFor, routeByKey } from '../navigation/routes';
import { openConnectionSettings } from './connectionSettings';
import { OfflineChip } from './OfflineCard';

/** The offline page's column never gets wider than this, so it stays a calm, centred
 * column on an iPad or Android tablet rather than stretching across the screen. */
export const OFFLINE_MAX_WIDTH = 520;

export interface OfflineStateProps {
  /** Called once "Try again" finds the connection is back (after refetching). */
  onReconnected?: () => void;
  /** The "Your downloads still play" card. Off where it would be beside the point. */
  showDownloads?: boolean;
}

const STEPS = ['Turn off Airplane Mode', 'Connect to Wi‑Fi or mobile data'];

/**
 * The "You're offline" body (offline mockups, Nii 2026-11-22): a gold cloud-off orb, the
 * serif title, two steps, Open Settings, Try again, and a way into downloads, which still
 * play offline. The offline page (`app/offline.tsx`) is this plus a back button; detail
 * screens that fail offline show it in place of their content.
 */
export function OfflineState({ onReconnected, showDownloads = true }: OfflineStateProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);

  const tryAgain = async () => {
    setChecking(true);
    setStillOffline(false);
    let online = true;
    try {
      const state = await Network.getNetworkStateAsync();
      online = state.isConnected !== false && state.isInternetReachable !== false;
    } catch {
      // Unknown counts as online: let the refetch decide.
    }
    if (online) {
      await queryClient.invalidateQueries();
      setChecking(false);
      onReconnected?.();
    } else {
      setChecking(false);
      setStillOffline(true);
    }
  };

  return (
    <View style={styles.column}>
      <View style={styles.hero}>
        <View style={styles.orbOuter}>
          <View style={styles.orbInner}>
            <OfflineChip size={88} />
          </View>
        </View>
        <AppText variant="mono.meta" tone="gold" style={styles.eyebrow}>
          NO CONNECTION
        </AppText>
        <AppText variant="display.hero" accessibilityRole="header" style={styles.center}>
          You&rsquo;re offline
        </AppText>
        <AppText variant="ui.bodyLarge" tone="secondary" style={styles.center}>
          RhemaPod can&rsquo;t reach the internet right now. Your phone may be in Airplane Mode or
          off Wi&#8209;Fi.
        </AppText>
      </View>

      <View style={styles.steps}>
        {STEPS.map((step, i) => (
          <View key={step} style={[styles.step, i > 0 && styles.stepDivider]}>
            <View style={styles.stepNumber}>
              <AppText variant="mono.tight" tone="gold">
                {i + 1}
              </AppText>
            </View>
            <AppText variant="ui.body" style={styles.stepText}>
              {step}
            </AppText>
          </View>
        ))}
      </View>

      <PrimaryButton
        label="Open Settings"
        icon="settings-outline"
        fullWidth
        onPress={() => void openConnectionSettings()}
      />
      <View style={styles.tryAgain}>
        <LinkButton
          label={checking ? 'Checking…' : 'Try again'}
          disabled={checking}
          onPress={() => void tryAgain()}
        />
        {stillOffline ? (
          <AppText variant="ui.badge" tone="tertiary" accessibilityLiveRegion="polite">
            Still offline. Check your settings, then try again.
          </AppText>
        ) : null}
      </View>

      {showDownloads ? (
        <Pressable
          onPress={() => router.navigate(pathnameFor(routeByKey('library')))}
          accessibilityRole="button"
          accessibilityLabel="Your downloads still play. Listen offline from Library."
          style={({ pressed }) => [styles.downloads, pressed && styles.pressed]}
        >
          <View style={styles.downloadChip}>
            <PlatformIcon name="download-outline" size={18} color={colors.accent.goldText} />
          </View>
          <View style={styles.downloadText}>
            <AppText variant="ui.bodyBold">Your downloads still play</AppText>
            <AppText variant="ui.badge" tone="secondary">
              Listen offline from Library
            </AppText>
          </View>
          <PlatformIcon name="chevron-forward" size={18} color={colors.text.tertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  column: {
    width: '100%',
    maxWidth: OFFLINE_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl,
  },
  orbOuter: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.splash.orbOuter,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowColor: colors.splash.glow,
    shadowOpacity: 0.35,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 0 },
  },
  orbInner: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.splash.orbInner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    letterSpacing: 2,
  },
  center: {
    textAlign: 'center',
  },
  steps: {
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  stepDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.chip.square,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    flex: 1,
  },
  tryAgain: {
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: -spacing.sm,
  },
  downloads: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.sunken,
    borderColor: colors.border.default,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.85,
  },
  downloadChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.chip.square,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadText: {
    flex: 1,
    gap: 2,
  },
}));

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, CircleButton, PlatformIcon, QueryState, SkeletonBlock } from '../components';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import { useMyBlocks, useUnblock } from '../lib/query/hooks/useBlocks';

/**
 * Me > Blocked users (design spec comments-and-player §3.2). `GET /me/blocks` lists the
 * authors the viewer blocked from a comment; Unblock needs no confirm (reversible, low
 * risk) and removes the row optimistically, restoring it if the request fails. Each row is
 * seeded by the author's display name — the DTO has no user id.
 *
 * Bare-chevron + centered-title header (Isaac's ask, session 2026-10-16: "use
 * preestablish navigation style") — same layout `category/[id]`/`speaker/[id]`/
 * `notifications` already use, in place of the native Stack header this screen fell
 * through to before (`app/_layout.tsx` disables it for this route for the same reason).
 *
 * Daybreak (canvas F3): round back button, a "Blocked people" title with a line on what
 * blocking does, each person on a card with the date they were blocked and an outlined
 * Unblock pill, and a sage "A kind, safe space" note at the foot.
 */
function blockedOn(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Blocked ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export default function BlockedUsersScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const blocksQuery = useMyBlocks();
  const unblock = useUnblock();
  const blocks = blocksQuery.data ?? [];

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
        {/* Back sits on the title's row (Nii, 2026-11-11). */}
        <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <AppText variant="display.hero" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={styles.title}>
          Blocked people
        </AppText>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBlock}>
          <AppText variant="ui.body" tone="secondary">
            You won't see their comments on any sermon. They aren't told.
          </AppText>
        </View>
        {blocksQuery.isLoading ? (
          <View accessibilityRole="progressbar" accessibilityLabel="Loading blocked users" style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.card}>
                <SkeletonBlock width={40} height={40} radiusToken="pill" />
                <SkeletonBlock width="40%" height={14} />
              </View>
            ))}
          </View>
        ) : (
          <QueryState
            isLoading={false}
            isError={blocksQuery.isError}
            error={blocksQuery.error}
            isEmpty={!blocksQuery.isError && blocks.length === 0}
            emptyTitle="You haven't blocked anyone."
            onRetry={() => blocksQuery.refetch()}
            loadingLabel="Loading blocked users"
          >
            <View style={styles.list}>
              {blocks.map((block) => {
                const when = blockedOn(block.created_at);
                return (
                  <View key={block.id} style={styles.card}>
                    <Avatar name={block.display_name} seed={block.display_name} size={40} />
                    <View style={styles.name}>
                      <AppText variant="ui.bodyBold" numberOfLines={1}>
                        {block.display_name}
                      </AppText>
                      {when ? (
                        <AppText variant="ui.badge" tone="tertiary">
                          {when}
                        </AppText>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => unblock.mutate(block.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Unblock ${block.display_name}`}
                      hitSlop={4}
                      style={({ pressed }) => [styles.unblock, pressed && styles.pressed]}
                    >
                      <AppText variant="ui.bodyBold">Unblock</AppText>
                    </Pressable>
                  </View>
                );
              })}
              {unblock.isError ? (
                <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
                  Couldn't unblock. Try again.
                </AppText>
              ) : null}
            </View>
          </QueryState>
        )}
        <View style={styles.note}>
          <View style={styles.noteIcon}>
            <PlatformIcon name="shield-checkmark-outline" size={30} color={colors.status.sage.text} />
          </View>
          <AppText variant="ui.bodyBold">A kind, safe space</AppText>
          <AppText variant="ui.label" tone="secondary" style={styles.noteBody}>
            Block anyone from a comment's menu. You can unblock them here any time.
          </AppText>
        </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg + 4,
  },
  title: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xl,
  },
  titleBlock: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm + 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  name: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  unblock: {
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  error: {
    color: colors.status.rose.text,
  },
  note: {
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginTop: spacing.xl,
  },
  noteIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.sage.bg,
  },
  noteBody: {
    textAlign: 'center',
    maxWidth: 260,
  },
}));

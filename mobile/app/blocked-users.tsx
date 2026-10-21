import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, IconButton, LinkButton, QueryState, SkeletonBlock } from '../components';
import { createThemedStyles } from '../theme/ThemeContext';
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
 */
export default function BlockedUsersScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const blocksQuery = useMyBlocks();
  const unblock = useUnblock();
  const blocks = blocksQuery.data ?? [];

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <AppText variant="ui.bodyLarge" style={styles.headerTitle}>
          Blocked users
        </AppText>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {blocksQuery.isLoading ? (
          <View accessibilityRole="progressbar" accessibilityLabel="Loading blocked users" style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.row}>
                <SkeletonBlock width={38} height={38} radiusToken="pill" />
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
              {blocks.map((block) => (
                <View key={block.id} style={styles.row}>
                  <Avatar name={block.display_name} seed={block.display_name} size={38} />
                  <AppText variant="ui.label" style={styles.name}>
                    {block.display_name}
                  </AppText>
                  <LinkButton
                    label="Unblock"
                    accessibilityLabel={`Unblock ${block.display_name}`}
                    onPress={() => unblock.mutate(block.id)}
                  />
                </View>
              ))}
              {unblock.isError ? (
                <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
                  Couldn't unblock. Try again.
                </AppText>
              ) : null}
            </View>
          </QueryState>
        )}
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
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  // Balances the back button's width so the centered title is actually centered.
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.xs,
  },
  name: {
    flex: 1,
  },
  error: {
    color: colors.status.rose.text,
  },
}));

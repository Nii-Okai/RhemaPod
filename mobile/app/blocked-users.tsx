import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { AppText, Avatar, LinkButton, QueryState, SkeletonBlock } from '../components';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useMyBlocks, useUnblock } from '../lib/query/hooks/useBlocks';

/**
 * Me > Blocked users (design spec comments-and-player §3.2). `GET /me/blocks` lists the
 * authors the viewer blocked from a comment; Unblock needs no confirm (reversible, low
 * risk) and removes the row optimistically, restoring it if the request fails. Each row is
 * seeded by the author's display name — the DTO has no user id.
 */
export default function BlockedUsersScreen() {
  const blocksQuery = useMyBlocks();
  const unblock = useUnblock();
  const blocks = blocksQuery.data ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Blocked users' }} />
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
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
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
});

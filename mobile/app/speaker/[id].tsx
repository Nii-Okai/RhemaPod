import React from 'react';
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, MediaRow, PlatformIcon, QueryState, RowPill } from '../../components';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { formatPublishedDate } from '../../lib/format/publishedDate';
import { spacing } from '../../theme/spacing';
import { useSearchResults } from '../../lib/query/hooks/useSearch';
import { usePullToRefresh } from '../../lib/hooks/usePullToRefresh';

/** A sermon published in the last two weeks wears a "New" pill. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/** Verbatim fallback copy — matches the admin portal's speaker row (speaker-row.tsx). */
const NO_BIO_FALLBACK = 'No bio yet';

function sermonCountLabel(count: number): string {
  return count === 1 ? '1 sermon' : `${count} sermons`;
}

/**
 * Daybreak redesign (canvas B6): round Back and Share buttons, a centred profile
 * (initials in a navy disc with a warm ring, name, count, bio, Play latest), then the
 * speaker's sermons as rows with their date and length, recent ones marked New.
 *
 * Speaker drill-down — reached by tapping a speaker row on Browse or from a Search
 * result. Custom back-chevron + centered-title header, native Stack header disabled
 * (Isaac's ask, session 2026-10-11: "use preestablish navigation style") — this screen
 * had been left on the Stack's own default native header this whole time
 * (`app/_layout.tsx` carried no `options` for this route at all); now the same
 * bare-chevron pattern `category/[id].tsx`/`series.tsx`'s own phone header established.
 *
 * Reorganized (same ask: "organise it better") around a real info header — an `Avatar`
 * initials chip (no speaker-photo field exists on `SpeakerPublic`, same fallback this
 * app already uses everywhere else a person has no photo on file), name, sermon count,
 * and bio — instead of bare stacked text with nothing to anchor it. Sermons render as a
 * `SermonCard` grid now, not the old text-only `SermonResultRow` (deleted — this was its
 * one remaining call site) — `category/[id].tsx`'s own established grid, so the app's
 * two "drill down from Browse" screens read as siblings instead of two different eras
 * of design. `showMeta={false}` on each card for the same reason `category/[id].tsx`
 * uses it: the meta line would just repeat this speaker's own name on every card.
 *
 * `name`/`bio`/`sermonCount` travel in via nav params — Browse's and Search's own
 * speaker lists already have the full `SpeakerPublic` in hand, so this avoids a second
 * fetch just to re-read three fields. The sermon list itself comes from `/search`
 * filtered on `speaker_id`, same as before.
 */
export default function SpeakerDrillDownScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id, name, bio, sermonCount } = useLocalSearchParams<{
    id: string;
    name?: string;
    bio?: string;
    sermonCount?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const results = useSearchResults({ speaker_id: id });
  const pullToRefresh = usePullToRefresh([results]);
  const displayName = name || 'Speaker';
  const count = sermonCount ? Number(sermonCount) : null;
  const sermons = results.data?.results ?? [];
  const now = Date.now();

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
        <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <CircleButton
          icon="share-outline"
          accessibilityLabel="Share"
          onPress={() => void Share.share({ message: `${displayName} on RhemaPod` })}
        />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      >
        {/* Centred profile (canvas B6): initials on a navy disc in a warm ring. */}
        <View style={styles.profile}>
          <View style={styles.ring}>
            <View style={styles.disc}>
              <AppText variant="display.hero" tone="inverse">
                {initialsOf(displayName)}
              </AppText>
            </View>
          </View>
          <AppText variant="display.title" accessibilityRole="header" style={styles.centered}>
            {displayName}
          </AppText>
          {count !== null ? (
            <AppText variant="ui.badge" tone="tertiary">
              {sermonCountLabel(count)}
            </AppText>
          ) : null}
          <AppText variant="ui.body" tone={bio ? 'secondary' : 'tertiary'} style={[styles.centered, styles.bio]}>
            {bio || NO_BIO_FALLBACK}
          </AppText>
          {sermons.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/player/[id]', params: { id: sermons[0].id } })}
              style={({ pressed }) => [styles.playLatest, pressed && styles.pressed]}
            >
              <PlatformIcon name="play" size={18} color={colors.primaryButton.text} />
              <AppText variant="ui.button" tone="inverse">
                Play latest
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.tabRow}>
          <View style={styles.tabOn}>
            <AppText variant="ui.bodyBold">Sermons</AppText>
          </View>
        </View>

        <View style={styles.list}>
          <QueryState
            isLoading={results.isLoading}
            isError={results.isError}
            error={results.error}
            isEmpty={!results.isLoading && !results.isError && sermons.length === 0}
            emptyTitle="No sermons yet"
            emptyDescription={name ? `Nothing published by ${name} yet.` : undefined}
            onRetry={() => results.refetch()}
            loadingLabel="Loading sermons"
          >
            {sermons.map((sermon, i) => {
              const published = sermon.publish_at ? Date.parse(sermon.publish_at) : NaN;
              const isNew = Number.isFinite(published) && now - published < NEW_FOR_MS && now >= published;
              const meta = [
                sermon.publish_at ? formatPublishedDate(sermon.publish_at) : null,
                sermon.duration_seconds ? `${Math.round(sermon.duration_seconds / 60)} min` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <MediaRow
                  key={sermon.id}
                  title={sermon.title}
                  meta={meta}
                  thumbnailUrl={sermon.thumbnail_url}
                  artSize={60}
                  trailing={isNew ? <RowPill label="New" tone="sun" /> : undefined}
                  divider={i < sermons.length - 1}
                  onPress={() => router.push({ pathname: '/player/[id]', params: { id: sermon.id } })}
                  queueSermon={sermon}
                />
              );
            })}
          </QueryState>
        </View>
      </ScrollView>
    </View>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .slice(-2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg + 4,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl * 2,
  },
  profile: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.xs,
  },
  ring: {
    width: 132,
    height: 132,
    borderRadius: 66,
    padding: 10,
    backgroundColor: colors.verse.bg,
  },
  disc: {
    flex: 1,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryButton.bg,
  },
  centered: {
    textAlign: 'center',
  },
  bio: {
    maxWidth: 320,
  },
  playLatest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: 22,
    backgroundColor: colors.primaryButton.bg,
  },
  pressed: {
    opacity: 0.85,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  tabOn: {
    paddingVertical: spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: colors.text.primary,
  },
  list: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.sm,
  },
}));

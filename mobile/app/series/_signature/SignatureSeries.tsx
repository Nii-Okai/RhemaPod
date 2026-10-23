import React, { useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ActionButton, AppText, CastCloseHeader, DetailError, PlatformIcon, Tag } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { Flame, GlowingFlame } from '../../(tabs)/_home/signature/Flame';
import type { DetailTab } from '../_detail/DetailTabs';
import { seriesMetaLine } from '../_detail/meta';
import { SeriesDetailSkeleton } from '../_detail/Skeleton';
import { useSeriesScreen } from '../_detail/useSeriesScreen';
import { ctaWording, episodeProgress, sharedSpeaker, type EpisodeProgress } from './episodeProgress';
import { SignatureEpisodeRow } from './SignatureEpisodeRow';
import { SignatureRelated } from './SignatureRelated';
import { SignatureTabs } from './SignatureTabs';
import { usePullToRefresh } from '../../../lib/hooks/usePullToRefresh';

// Full-bleed cover, running up under the status bar (Nii's edit to the mockup: a bigger
// top image than the classic page's inset 4:3 banner).
const HERO_ASPECT = 3 / 4;
const HERO_CORNER = 28;
const FLAME_WIDTH = 15;

/**
 * Series detail in the Signature redesign (mockup "RhemaPod — Signature", series page),
 * behind `EXPO_PUBLIC_SIGNATURE_SERIES`. Same data and actions as the classic screen —
 * both read `useSeriesScreen` — drawn as: a full-width cover, tier and meta, the title
 * and its speaker, a Resume/Play pill that names the part and the time left, a row of
 * flames for the episodes watched, Download all / My List / Like / Share, then the
 * Episodes and Related tabs. No comments block (Nii's edit). Every colour comes from the
 * active theme, so it draws in light and dark alike.
 */
export function SignatureSeriesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<DetailTab>('episodes');
  const screen = useSeriesScreen(id);
  const pullToRefresh = usePullToRefresh([screen.series, screen.episodes, screen.history]);
  const { series, episodes, episodeItems, historyMap, cta, downloads, downloadableEpisodes } = screen;

  const progress = useMemo(
    () => new Map<string, EpisodeProgress>(episodeItems.map((ep) => [ep.id, episodeProgress(ep, historyMap.get(ep.id))])),
    [episodeItems, historyMap],
  );

  const header = <CastCloseHeader onClose={screen.onCloseAll} castEnabled />;

  if (series.isLoading || episodes.isLoading) {
    return (
      <View style={styles.screen}>
        {header}
        <SeriesDetailSkeleton />
      </View>
    );
  }

  if (series.isError || !series.data) {
    return (
      <View style={styles.screen}>
        {header}
        <DetailError message="Something went wrong loading this series." onRetry={() => series.refetch()} />
      </View>
    );
  }

  const detail = series.data;
  const speaker = sharedSpeaker(episodeItems);
  const resumeId = cta?.label === 'Resume' ? cta.episodeId : null;
  const wording = cta ? ctaWording(cta, episodeItems.find((ep) => ep.id === cta.episodeId)) : null;
  const doneCount = episodeItems.filter((ep) => progress.get(ep.id)?.state === 'done').length;
  const showWalk = doneCount > 0 || resumeId !== null;
  const allDownloaded =
    downloadableEpisodes.length > 0 &&
    downloadableEpisodes.every((ep) => downloads.find(ep.sermonId)?.state === 'ready');
  const episodeWord = (n: number) => `${n} episode${n === 1 ? '' : 's'}`;

  const flame = (state: EpisodeProgress['state'], episodeId: string) => {
    if (episodeId === resumeId) return <GlowingFlame width={FLAME_WIDTH} fill="transparent" stroke={colors.accent.gold} />;
    if (state === 'done') return <Flame width={FLAME_WIDTH} fill={colors.accent.gold} stroke={colors.accent.gold} />;
    if (state === 'started') return <Flame width={FLAME_WIDTH} fill="transparent" stroke={colors.accent.gold} />;
    return <Flame width={FLAME_WIDTH} fill="transparent" stroke={colors.border.card} />;
  };

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      >
        <View testID="series-hero" style={[styles.hero, { height: width * HERO_ASPECT + insets.top }]}>
          {detail.thumbnail_url ? (
            <Image source={{ uri: detail.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : null}
        </View>

        <View style={styles.body}>
          <View style={styles.metaRow}>
            <Tag label={detail.tier === 'paid' ? 'Members' : 'Free'} />
            <AppText variant="mono.meta" tone="tertiary" style={styles.shrink}>
              {`Series · ${seriesMetaLine(detail)}`.toUpperCase()}
            </AppText>
          </View>

          <View style={styles.titleBlock}>
            <AppText variant="display.hero" accessibilityRole="header">
              {detail.title}
            </AppText>
            {speaker ? (
              <AppText variant="ui.body" tone="secondary">
                {speaker}
              </AppText>
            ) : null}
          </View>

          {cta && wording ? (
            <Pressable
              onPress={() => screen.playEpisode(cta.episodeId)}
              accessibilityRole="button"
              accessibilityLabel={cta.accessibilityLabel}
              style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
            >
              <PlatformIcon name="play" size={18} color={colors.primaryButton.text} />
              <AppText variant="ui.button" tone="inverse">
                {wording.label}
              </AppText>
              {wording.readout ? (
                <AppText variant="mono.meta" tone="inverse">
                  {`· ${wording.readout}`}
                </AppText>
              ) : null}
            </Pressable>
          ) : null}

          {showWalk ? (
            <View
              style={styles.walk}
              accessible
              accessibilityLabel={`${doneCount} of ${episodeWord(episodeItems.length)} watched`}
            >
              {episodeItems.map((ep) => (
                <View key={ep.id}>{flame(progress.get(ep.id)?.state ?? 'ahead', ep.id)}</View>
              ))}
              <AppText variant="mono.meta" tone="tertiary" style={styles.walkCount}>
                {`${doneCount} OF ${episodeItems.length} WATCHED`}
              </AppText>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            {downloadableEpisodes.length > 0 ? (
              <View style={styles.action}>
                <ActionButton
                  icon={allDownloaded ? 'checkmark' : 'download-outline'}
                  label={allDownloaded ? 'Downloaded' : 'Download all'}
                  accessibilityLabel={
                    allDownloaded
                      ? `All ${episodeWord(downloadableEpisodes.length)} downloaded`
                      : `Download all ${episodeWord(downloadableEpisodes.length)}`
                  }
                  selected={allDownloaded}
                  onPress={() => screen.onDownloadAll(downloadableEpisodes)}
                />
              </View>
            ) : null}
            <View style={styles.action}>
              <ActionButton
                icon={screen.inMyList ? 'checkmark' : 'add'}
                label="My List"
                accessibilityLabel={screen.inMyList ? 'Remove from My List' : 'Add to My List'}
                selected={screen.inMyList}
                onPress={screen.toggleAllInMyList}
              />
            </View>
            <View style={styles.action}>
              <ActionButton
                icon={detail.liked_by_me ? 'heart' : 'heart-outline'}
                label="Like"
                badgeCount={detail.like_count}
                accessibilityLabel={
                  detail.like_count > 0
                    ? `${detail.liked_by_me ? 'Unlike' : 'Like'}, ${detail.like_count} likes`
                    : detail.liked_by_me
                      ? 'Unlike'
                      : 'Like'
                }
                selected={detail.liked_by_me}
                onPress={() => screen.toggleLike.toggle(detail.liked_by_me)}
              />
            </View>
            <View style={styles.action}>
              <ActionButton icon="share-outline" label="Share" accessibilityLabel="Share this series" onPress={screen.onShare} />
            </View>
          </View>

          {detail.description ? (
            <AppText variant="ui.body" tone="secondary">
              {detail.description}
            </AppText>
          ) : null}
        </View>

        <SignatureTabs active={tab} onChange={setTab} />

        {tab === 'episodes' ? (
          <View style={styles.episodes}>
            {episodeItems.length === 0 ? (
              <AppText variant="ui.body" tone="secondary">
                No episodes yet. Check back once this series has published episodes.
              </AppText>
            ) : (
              episodeItems.map((ep) => (
                <SignatureEpisodeRow
                  key={ep.id}
                  episode={ep}
                  progress={progress.get(ep.id) as EpisodeProgress}
                  current={ep.id === resumeId}
                  onPress={() => screen.playEpisode(ep.id)}
                />
              ))
            )}
          </View>
        ) : (
          <SignatureRelated seriesId={detail.id} categoryId={detail.category_id} onPressSermon={screen.goToEpisode} />
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
  content: {
    paddingBottom: spacing.xxl * 2,
  },
  // The leaf shape on the cover's lower edge; the top runs off the screen.
  hero: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
    borderBottomRightRadius: HERO_CORNER,
    borderBottomLeftRadius: 6,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shrink: {
    flexShrink: 1,
  },
  titleBlock: {
    gap: spacing.xs,
  },
  pill: {
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryButton.bg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
  },
  walk: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  walkCount: {
    marginLeft: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
  },
  action: {
    flex: 1,
    alignItems: 'center',
  },
  episodes: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
}));

import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { READABLE_MAX_WIDTH, TWO_PANE_MIN_WIDTH } from '../../../components/navigation/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ActionButton, AppText, CastCloseHeader, HeroStatusBar, DetailError, DetailNotAvailable, FittedArt, PlatformIcon, Tag } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { DetailTab } from '../_detail/DetailTabs';
import { seriesMetaLine } from '../_detail/meta';
import { SeriesDetailSkeleton } from '../_detail/Skeleton';
import { isNotFoundError } from '../../../lib/api/errors';
import { useSeriesScreen } from '../_detail/useSeriesScreen';
import { ctaWording, episodeProgress, sharedSpeaker, type EpisodeProgress } from './episodeProgress';
import { SignatureEpisodeRow } from './SignatureEpisodeRow';
import { SignatureRelated } from './SignatureRelated';
import { SignatureTabs } from './SignatureTabs';
import { usePullToRefresh } from '../../../lib/hooks/usePullToRefresh';

// Full-bleed cover, running up under the status bar (Nii's edit to the mockup: a bigger
// top image than the classic page's inset 4:3 banner).
const HERO_ASPECT = 3 / 4;
const HERO_CORNER = 36;
// Single column on a tablet in portrait: the cover stops at about half the screen.
const HERO_MAX_SCREEN_SHARE = 0.55;
// Two panes (tablet landscape): the cover and actions in a fixed-width pane on the left.
const SIDE_PANE_WIDTH = 420;
const SIDE_PANE_PADDING = spacing.lg + 4;
// Room for the floating Back / Cast / Close buttons above each pane's content.
const HEADER_CLEARANCE = 44 + spacing.lg;

/**
 * Daybreak redesign (canvas C2): the cover with rounded lower corners, a gold "Series
 * · N episodes" eyebrow over the title, the Resume pill, the action tiles, then
 * Episodes / Related with "N of M finished" on the tab row and the episodes drawn as a
 * path of numbered nodes (green when finished, gold for the one you're on).
 *
 * Series detail in the Signature redesign (mockup "RhemaPod — Signature", series page),
 * behind `EXPO_PUBLIC_SIGNATURE_SERIES`. Same data and actions as the classic screen —
 * both read `useSeriesScreen` — drawn as: a full-width cover, tier and meta, the title
 * and its speaker, a Resume/Play pill that names the part and the time left, a row of
 * flames for the episodes watched, Download all / My List / Like / Share, then the
 * Episodes and Related tabs. No comments block (Nii's edit). Every colour comes from the
 * active theme, so it draws in light and dark alike.
 *
 * On a tablet (mockups, Nii 2026-11-21) it splits into two panes at TWO_PANE_MIN_WIDTH:
 * the cover, title and actions on the left, the tabs and episodes scrolling on the right.
 * Narrower than that (tablet portrait) it keeps one column, with the cover capped and the
 * text kept to a readable width.
 */
export function SignatureSeriesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const twoPane = width >= TWO_PANE_MIN_WIDTH;
  const [tab, setTab] = useState<DetailTab>('episodes');
  // Light status-bar glyphs while the cover is under the bar (see HeroStatusBar).
  const [overHero, setOverHero] = useState(true);
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

  if (isNotFoundError(series.error)) {
    return (
      <View style={styles.screen}>
        {header}
        <DetailNotAvailable subject="series" onGoHome={screen.goHome} />
      </View>
    );
  }

  if (series.isError || !series.data) {
    return (
      <View style={styles.screen}>
        {header}
        <DetailError
          message="Something went wrong loading this series."
          onRetry={() => series.refetch()}
          error={series.error}
        />
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

  const details = (
    <>
      <View style={[styles.body, !twoPane && styles.readable]}>
        <View style={styles.metaRow}>
          <AppText variant="ui.badge" tone="gold" style={[styles.shrink, styles.eyebrow]}>
            {`Series · ${seriesMetaLine(detail)}`.toUpperCase()}
          </AppText>
          <Tag label={detail.tier === 'paid' ? 'Members' : 'Free'} />
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
    </>
  );
  const tabsAndList = (
    <>
      <View style={!twoPane && styles.readable}>
        <SignatureTabs
          active={tab}
          onChange={setTab}
          note={showWalk ? `${doneCount} of ${episodeItems.length} finished` : null}
        />
      </View>

      {tab === 'episodes' ? (
        <View style={[styles.episodes, !twoPane && styles.readable]}>
          {episodeItems.length === 0 ? (
            <AppText variant="ui.body" tone="secondary">
              No episodes yet. Check back once this series has published episodes.
            </AppText>
          ) : (
            episodeItems.map((ep, index) => (
              <SignatureEpisodeRow
                key={ep.id}
                episode={ep}
                progress={progress.get(ep.id) as EpisodeProgress}
                current={ep.id === resumeId}
                position={index + 1}
                last={index === episodeItems.length - 1}
                onPress={() => screen.playEpisode(ep.id)}
              />
            ))
          )}
        </View>
      ) : (
        <SignatureRelated
          seriesId={detail.id}
          categoryId={detail.category_id}
          onPressSermon={screen.goToEpisode}
          width={twoPane ? width - SIDE_PANE_WIDTH : width}
        />
      )}
    </>
  );

  if (twoPane) {
    const paneTop = insets.top + HEADER_CLEARANCE;
    return (
      <View style={styles.screen}>
        <HeroStatusBar active={false} />
        <View style={styles.panes}>
          <ScrollView
            testID="series-side-pane"
            style={styles.sidePane}
            contentContainerStyle={[styles.sidePaneContent, { paddingTop: paneTop }]}
            showsVerticalScrollIndicator={false}
          >
            <View testID="series-hero" style={styles.sideCover}>
              {detail.thumbnail_url ? <FittedArt uri={detail.thumbnail_url} /> : null}
            </View>
            {details}
          </ScrollView>
          <ScrollView
            style={styles.mainPane}
            contentContainerStyle={[styles.content, { paddingTop: paneTop }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl {...pullToRefresh} />}
          >
            {tabsAndList}
          </ScrollView>
        </View>
        {header}
      </View>
    );
  }

  const heroHeight = Math.min(width * HERO_ASPECT, windowHeight * HERO_MAX_SCREEN_SHARE) + insets.top;
  return (
    <View style={styles.screen}>
      <HeroStatusBar active={overHero} />
      {header}
      <ScrollView
        onScroll={(e) => setOverHero(e.nativeEvent.contentOffset.y < heroHeight - insets.top)}
        scrollEventThrottle={32}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      >
        <View testID="series-hero" style={[styles.hero, { height: heroHeight }]}>
          {detail.thumbnail_url ? (
            <FittedArt uri={detail.thumbnail_url} />
          ) : null}
        </View>

        {details}
        {tabsAndList}
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
    borderBottomLeftRadius: HERO_CORNER,
  },
  body: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  eyebrow: {
    letterSpacing: 1.5,
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
  actionRow: {
    flexDirection: 'row',
  },
  action: {
    flex: 1,
    alignItems: 'center',
  },
  episodes: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg + 2,
  },
  // Tablet portrait: text and lists stop at a readable width, centred under the cover.
  readable: {
    width: '100%',
    maxWidth: READABLE_MAX_WIDTH,
    alignSelf: 'center',
  },
  panes: {
    flex: 1,
    flexDirection: 'row',
  },
  sidePane: {
    width: SIDE_PANE_WIDTH,
    flexGrow: 0,
    borderRightWidth: 1,
    borderRightColor: colors.border.default,
  },
  sidePaneContent: {
    paddingBottom: spacing.xxl,
  },
  sideCover: {
    marginHorizontal: SIDE_PANE_PADDING,
    aspectRatio: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  mainPane: {
    flex: 1,
  },
}));

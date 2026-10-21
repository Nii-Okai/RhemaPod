import React, { useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActionButton, AppText, CastCloseHeader, DetailError, PrimaryButton, Tag } from '../../components';
import { DownloadPillButton, type DownloadPillItem } from '../../components/DownloadPillButton';
import { EpisodeRow } from '../../components/series/EpisodeRow';
import { RelatedSermons } from '../../components/sermon/RelatedSermons';
import { createThemedStyles } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { RELATED_PARAM, RELATED_PARAM_VALUE } from '../../lib/navigation/detailTransition';
import { useAddToDefaultLibrary } from '../../lib/query/hooks/usePlaylists';
import { useSeriesDetail, useSeriesEpisodes, useToggleSeriesLike } from '../../lib/query/hooks/useSeries';
import { useWatchHistory } from '../../lib/query/hooks/useWatchHistory';
import { buildHistoryMap } from '../../lib/format/episodeStatus';
import { shareContent } from '../../lib/share/shareContent';
import { resolveSeriesCta } from './_detail/cta';
import { DetailTabs, type DetailTab } from './_detail/DetailTabs';
import { seriesMetaLine } from './_detail/meta';
import { SeriesDetailSkeleton } from './_detail/Skeleton';

/**
 * Series detail (design spec 1h, plan W4.4) — a top-level stack route (plan L15/§A.7):
 * one route, identical on every platform, registered in `app/_layout.tsx` next to
 * `sermon/[id]`, `category/[id]`, `speaker/[id]`. Reached from Home's Series shelf
 * (W4.1), Browse (W4.3), and this slice's own tablet Series rail tab
 * (`(tabs)/series.tsx`).
 *
 * Rebuilt (Isaac's ask, session 2026-09-30, Netflix's title-page reference) to mirror
 * sermon-detail's own hero-style layout rather than the previous flat art+title+list —
 * `DetailError` is a promoted, shared component (sermon detail was its only consumer
 * before this); the nav chrome is `CastCloseHeader` (Cast+Close, session 2026-09-30,
 * promoted to shared once sermon detail became its second consumer, session
 * 2026-10-01 — sermon detail's original platform-swapped `DetailHeader` was retired
 * with no other consumers left). Three things from the Netflix reference are
 * deliberately NOT built, flagged rather than faked:
 *  - No "Collection" / "More Like This" / "Trailers" tabs — this app has no data for
 *    any of them (no related-series, no recommendation-per-series, no trailer
 *    renditions). A tab that opens onto nothing is worse than no tab.
 *  - No star rating or cadence ("New Episode Daily") line — `SeriesPublic` carries no
 *    such fields; inventing one client-side would just be made up.
 *  - "Set Reminders" is cut for the same no-backing-data reason — see `ActionButton`'s
 *    own doc comment for what *did* ship there (My List, Like, Share, Download) and
 *    why. "Rate" is represented by Like instead (session 2026-10-01), same
 *    substitution sermon detail already made.
 *
 * Play and Download stack as two full-width pills (Isaac's ask, session 2026-09-30 —
 * Netflix's own title-page pair: white Play directly above gray Download, same width).
 * Unlike the Play CTA (which always targets whichever episode `resolveSeriesCta` picks),
 * the Download pill targets the whole series (Isaac's ask, session 2026-10-08: "the top
 * horizontal download pill is used to download media for all episodes") — it's given
 * every episode with a rendition (`downloadableEpisodes`) and its own `aggregate()` folds
 * all of them into one progress readout, same mechanism `EpisodeDownloadButton` uses
 * per-row. The action row's own Download button (session 2026-10-01, matching a
 * different Netflix reference screenshot — My List/Rate/Share/Download as four
 * evenly-spaced icons) now queues the identical set as a second, harmless entry point to
 * the same bulk action, not a separate one.
 *
 * The Play/Resume CTA (`resolveSeriesCta`) reads off `GET /me/history?series_id=<id>` to
 * pick Resume vs. Play and which episode — scoped to this series (Decision 6) rather
 * than the app-wide capped read, so that pick stays accurate regardless of episode
 * count. If that call fails, the CTA falls back to plain "Play" (first episode) rather
 * than blocking the whole screen on a secondary query. `EpisodeRow` itself no longer
 * shows a per-row watch-status label (it showed episode duration instead, Isaac's ask,
 * session 2026-09-30 — see `EpisodeRow`'s own doc comment) so `/me/history` now only
 * feeds the CTA, not the episode list.
 *
 * Episode numbers come straight from `GET /series/{id}/episodes`, which is already
 * renumbered to a contiguous 1..N sequence server-side (plan L11/W2.3,
 * `content_service.renumber_for_display`) — this screen never renumbers, sorts, or hides
 * a row itself; an unnumbered episode (`episode_number: null`) renders with no number,
 * never a placeholder digit (see `EpisodeRow`'s own doc comment).
 */
export default function SeriesDetailScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const series = useSeriesDetail(id);
  const episodes = useSeriesEpisodes(id);
  const history = useWatchHistory(id);
  const defaultLibrary = useAddToDefaultLibrary();
  const [tab, setTab] = useState<DetailTab>('episodes');
  const toggleLike = useToggleSeriesLike(id);
  const downloads = useDownloads();

  const historyMap = useMemo(() => buildHistoryMap(history.data ?? []), [history.data]);
  const cta = useMemo(
    () => resolveSeriesCta(episodes.data ?? [], history.isError ? new Map() : historyMap),
    [episodes.data, historyMap, history.isError],
  );

  // Close (the X) dismisses the whole stack — "close all pages" (Isaac's ask, session
  // 2026-10-01), however many Related/episode drill-down levels deep the user is —
  // rather than going back just one level.
  const onCloseAll = () => router.dismissAll();
  // Pushes `sermon/related/[id]` (not the plain `sermon/[id]` route), used for the Play
  // CTA, every episode row, and the Related tab alike (Isaac's ask, session 2026-10-01:
  // an episode row tap is the same kind of drill-down a Related tap is, so it gets the
  // same regular horizontal push/back-gesture and the destination's own back chevron —
  // see `app/sermon/related/[id].tsx`'s own doc comment for why that's a second route
  // rather than the plain `sermon/[id]` screen). Series detail itself is never one of
  // the alternating "Related" routes (`nextRelatedSermonRoute`'s own doc comment), so
  // every push from here always targets the same one, `sermon/related/[id]`.
  const goToEpisode = (sermonId: string) =>
    router.push({ pathname: '/sermon/related/[id]', params: { id: sermonId, [RELATED_PARAM]: RELATED_PARAM_VALUE } });

  const onShare = () => {
    if (!series.data) return;
    void shareContent({
      title: series.data.title,
      description: series.data.description,
      thumbnailUrl: series.data.thumbnail_url,
      deepLinkPath: `series/${series.data.id}`,
    });
  };

  // Queues every episode through the same `useDownloads()` pipeline every other
  // download control in this app uses — `download()` is already a no-op for anything
  // not fresh/failed (`downloadManager.enqueueDownload`'s own doc comment), so calling
  // it for an already-downloading or already-ready episode is safe, not a duplicate.
  // Downloads whichever rendition each episode actually has (Isaac's ask, session
  // 2026-10-08: "download based on the media type available for each episode") — an
  // episode with no rendition at all yet is skipped, not retried as a failure.
  const onDownloadAll = (episodeList: DownloadPillItem[]) => {
    episodeList.forEach((episode) => {
      void downloads.download(episode.sermonId, episode.title, episode.mediaType, episode.thumbnailUrl, episode.category);
    });
  };

  if (series.isLoading || episodes.isLoading) {
    return (
      <View style={styles.screen}>
        <CastCloseHeader onClose={onCloseAll} />
        <SeriesDetailSkeleton />
      </View>
    );
  }

  if (series.isError || !series.data) {
    return (
      <View style={styles.screen}>
        <CastCloseHeader onClose={onCloseAll} />
        <DetailError message="Something went wrong loading this series." onRetry={() => series.refetch()} />
      </View>
    );
  }

  const detail = series.data;
  const episodeItems = episodes.data ?? [];
  // Episodes with no rendition uploaded yet have nothing to download — the pill (and
  // the action row's own bulk button below) both filter them out rather than queuing a
  // request that can only 409.
  const downloadableEpisodes: DownloadPillItem[] = episodeItems
    .filter((episode): episode is typeof episode & { media_type: 'audio' | 'video' } => Boolean(episode.media_type))
    .map((episode) => ({
      sermonId: episode.id,
      title: episode.title,
      mediaType: episode.media_type,
      thumbnailUrl: episode.thumbnail_url,
      category: episode.category_name,
    }));
  // "My List" toggles every episode at once, same bulk-operate-on-the-whole-series
  // convention Download already established above — unlike Download, this doesn't need
  // a rendition to exist (`downloadableEpisodes`'s own filter), so it targets every
  // episode rather than just the downloadable subset. "Already added" is only true once
  // every episode is in, not just some — a checkmark implying "fully done" when half
  // the series is still missing would be misleading. Toggling off (Isaac's ask, session
  // 2026-10-11: "allow user toggle") removes every episode, since by definition all of
  // them are in whenever this reads true; toggling on only adds whichever are still
  // missing — `useAddToDefaultLibrary`'s own `toggleSermons` doesn't blindly re-add
  // ones already there.
  const inMyList = episodeItems.length > 0 && episodeItems.every((episode) => defaultLibrary.isInDefaultLibrary(episode.id));
  const toggleAllInMyList = () => defaultLibrary.toggleSermons(episodeItems.map((episode) => episode.id));

  return (
    <View style={styles.screen}>
      <CastCloseHeader onClose={onCloseAll} />
      {/* Outside the ScrollView, in normal flow above it — not absolutely positioned
          behind scrolling content — so it never moves as the content below scrolls.
          Pull-to-dismiss (which does move the hero, along with everything else) is the
          Stack screen's own native vertical gesture (`app/_layout.tsx`'s
          `gestureDirection: 'vertical'`), not anything this screen drives itself. */}
      <View style={{ paddingTop: insets.top }}>
        {detail.thumbnail_url ? (
          <Image source={{ uri: detail.thumbnail_url }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={styles.heroFallback} />
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.body}>
          <AppText variant="display.compact">{detail.title}</AppText>
          <View style={styles.metaRow}>
            <AppText variant="mono.meta" tone="tertiary">
              {seriesMetaLine(detail)}
            </AppText>
            <Tag label={detail.tier === 'paid' ? 'Members' : 'Free'} />
          </View>

          {cta ? (
            <View style={styles.ctaSection}>
              <PrimaryButton
                label={cta.label}
                accessibilityLabel={cta.accessibilityLabel}
                icon="play"
                fullWidth
                onPress={() => goToEpisode(cta.episodeId)}
              />
              <DownloadPillButton items={downloadableEpisodes} label="Download all episodes" />
            </View>
          ) : null}

          {detail.description ? (
            <AppText variant="ui.body" tone="secondary">
              {detail.description}
            </AppText>
          ) : null}

          <View style={styles.actionRow}>
            <ActionButton
              icon={inMyList ? 'checkmark' : 'add'}
              label="My List"
              accessibilityLabel={inMyList ? 'Remove from My List' : 'Add to My List'}
              selected={inMyList}
              onPress={toggleAllInMyList}
            />
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
              onPress={() => toggleLike.toggle(detail.liked_by_me)}
            />
            <ActionButton icon="share-outline" label="Share" accessibilityLabel="Share this series" onPress={onShare} />
            {downloadableEpisodes.length > 0 ? (
              <ActionButton
                icon="download-outline"
                label={`Download\n${downloadableEpisodes.length} Episode${downloadableEpisodes.length === 1 ? '' : 's'}`}
                accessibilityLabel={`Download all ${downloadableEpisodes.length} episode${downloadableEpisodes.length === 1 ? '' : 's'}`}
                onPress={() => onDownloadAll(downloadableEpisodes)}
              />
            ) : null}
          </View>
        </View>

        <DetailTabs active={tab} onChange={setTab} />

        {tab === 'episodes' ? (
          <View style={styles.episodesSection}>
            {episodeItems.length === 0 ? (
              <AppText variant="ui.body" tone="secondary">
                No episodes yet. Check back once this series has published episodes.
              </AppText>
            ) : (
              episodeItems.map((episode) => (
                <EpisodeRow key={episode.id} episode={episode} onPress={() => goToEpisode(episode.id)} />
              ))
            )}
          </View>
        ) : (
          <View style={styles.relatedSection}>
            <RelatedSermons
              categoryId={detail.category_id}
              excludeSeriesId={detail.id}
              onPressSermon={goToEpisode}
            />
          </View>
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
  // 4:3, not 16:9 — Isaac's ask, session 2026-09-30: a bigger banner. Matches
  // `HeroCard`'s own art ratio on Home, so this isn't a one-off proportion.
  // `overflow: 'hidden'` (Isaac's ask, session 2026-10-01) — without it Android doesn't
  // reliably clip the Image's own corners to `borderRadius`, so the cover-cropped art
  // (already centered by `resizeMode="cover"`'s own default) reads as spilling past the
  // rounded edge instead of a clean center crop.
  hero: {
    aspectRatio: 4 / 3,
    marginHorizontal: spacing.xs,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  heroFallback: {
    aspectRatio: 4 / 3,
    marginHorizontal: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ctaSection: {
    gap: spacing.sm,
  },
  // Edge-to-edge `space-between` (Isaac's own Netflix reference screenshot, session
  // 2026-10-01, for the 4-action My List/Like/Share/Download row — a 3-action row
  // earlier the same session used fixed left-aligned gaps instead; four full-width
  // items is what that screenshot actually shows).
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  episodesSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  relatedSection: {
    paddingTop: spacing.md,
  },
}));

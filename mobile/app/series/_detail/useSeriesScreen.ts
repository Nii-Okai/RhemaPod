import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import type { DownloadPillItem } from '../../../components/DownloadPillButton';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import { buildHistoryMap } from '../../../lib/format/episodeStatus';
import { RELATED_PARAM, RELATED_PARAM_VALUE } from '../../../lib/navigation/detailTransition';
import { useAddToDefaultLibrary } from '../../../lib/query/hooks/usePlaylists';
import { useSeriesDetail, useSeriesEpisodes, useToggleSeriesLike } from '../../../lib/query/hooks/useSeries';
import { useWatchHistory } from '../../../lib/query/hooks/useWatchHistory';
import { shareContent } from '../../../lib/share/shareContent';
import { resolveSeriesCta } from './cta';

/**
 * Everything series detail reads and does, shared by the classic screen and the
 * Signature redesign (`../_signature/`) so the two skins can't drift apart while the
 * rollout flag decides which one draws it.
 */
export function useSeriesScreen(id: string) {
  const router = useRouter();
  const series = useSeriesDetail(id);
  const episodes = useSeriesEpisodes(id);
  const history = useWatchHistory(id);
  const defaultLibrary = useAddToDefaultLibrary();
  const toggleLike = useToggleSeriesLike(id);
  const downloads = useDownloads();

  // A failed history read falls back to "nothing watched" (plain Play) rather than
  // blocking the screen on a secondary query.
  const historyMap = useMemo(
    () => buildHistoryMap(history.isError ? [] : (history.data ?? [])),
    [history.data, history.isError],
  );
  const cta = useMemo(() => resolveSeriesCta(episodes.data ?? [], historyMap), [episodes.data, historyMap]);

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

  return {
    series,
    episodes,
    episodeItems,
    historyMap,
    cta,
    toggleLike,
    downloads,
    downloadableEpisodes,
    inMyList,
    toggleAllInMyList,
    onCloseAll,
    goToEpisode,
    onShare,
    onDownloadAll,
  };
}

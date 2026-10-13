import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../Text';
import { PlatformIcon } from '../PlatformIcon';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { scaledLineHeight } from '../../theme/typography';
import { formatDuration } from '../../lib/format/duration';
import { EpisodeDownloadButton } from './EpisodeDownloadButton';
import type { SeriesEpisode } from '../../lib/query/hooks/useSeries';

export interface EpisodeRowProps {
  episode: SeriesEpisode;
  onPress: () => void;
}

const THUMBNAIL_WIDTH = 100;
const TITLE_FONT_SIZE = 14;

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * One series-episode row (design spec 1h, reworked per Isaac's ask, session
 * 2026-09-30): thumbnail (a centered play-button glyph and a duration badge in its
 * bottom-right corner, both overlaid and purely visual — the whole row is already one
 * tap target, same reasoning as `HeroCard`'s own non-interactive play circle), title,
 * a speaker-name meta line — and, at the row's far end, its own `EpisodeDownloadButton`.
 *
 * No episode-number badge renders (Isaac's ask, same session) — episode order is
 * already conveyed by list position. The number is still folded into
 * `accessibilityLabel` when present, though: a screen-reader user loses the visual
 * ordering cue sighted users get for free from row position, so it's worth more to
 * them than it is to a sighted viewer, not less (same reasoning `ImageOnlyCard` already
 * applies to its own hidden title).
 *
 * The meta line shows the episode's speaker (`episode.speaker_name`) — duration moved
 * to the thumbnail's own corner badge instead, so nothing renders it twice. No status
 * ("watched"/"new") or speaker fallback renders here: `/me/history` is still fetched by
 * the screen (the Play/Resume CTA still needs it), this row never displays it, and an
 * episode with no speaker on file just gets no meta line rather than a fabricated one.
 *
 * Only one title-looking line renders. The synopsis line ("episode details", Isaac's
 * own words for it, session 2026-09-30) reuses `episode.description` — but this
 * content's descriptions currently duplicate their own episode's title verbatim (a
 * content-import artifact, confirmed against the live API, not a permanent rule),
 * which read as the title rendering twice. Suppressing an exact (trimmed,
 * case-insensitive) match fixes that without disabling the synopsis line for an
 * episode that actually has a distinct one.
 *
 * Title and speaker are left-aligned against the thumbnail, matching the Netflix
 * reference (Isaac's ask, session 2026-09-30 — an earlier round had centered them,
 * reverted this round). The thumbnail is narrower and the title smaller too (an
 * earlier ask, same session), both "slightly" per the literal instruction — see
 * `THUMBNAIL_WIDTH`/`TITLE_FONT_SIZE`.
 */
export function EpisodeRow({ episode, onPress }: EpisodeRowProps) {
  const number = episode.episode_number !== null ? String(episode.episode_number).padStart(2, '0') : null;
  const duration = formatDuration(episode.duration_seconds);
  const showSynopsis = Boolean(episode.description) && normalize(episode.description as string) !== normalize(episode.title);

  const accessibleParts = [number ? `Episode ${number}` : null, episode.title, episode.speaker_name].filter(
    (part): part is string => Boolean(part),
  );

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibleParts.join(', ')}
        style={({ pressed }) => [styles.pressableArea, pressed && styles.rowPressed]}
      >
        <View style={styles.artWrap}>
          {episode.thumbnail_url ? (
            <Image source={{ uri: episode.thumbnail_url }} style={styles.thumbnail} resizeMode="cover" />
          ) : (
            <View style={styles.thumbnailFallback} />
          )}
          <View style={styles.playButtonWrap} pointerEvents="none">
            <View style={styles.playButton}>
              <PlatformIcon name="play" size={14} color={colors.text.primary} />
            </View>
          </View>
          <View style={styles.durationBadge} pointerEvents="none">
            <AppText variant="mono.tight" tone="primary" style={styles.durationText}>
              {duration}
            </AppText>
          </View>
        </View>
        <View style={styles.textBlock}>
          <AppText variant="display.compact" numberOfLines={2} style={styles.title}>
            {episode.title}
          </AppText>
          {episode.speaker_name ? (
            <AppText variant="ui.label" tone="tertiary" style={styles.meta}>
              {episode.speaker_name}
            </AppText>
          ) : null}
          {showSynopsis ? (
            <AppText variant="ui.body" tone="secondary" numberOfLines={2} style={styles.synopsis}>
              {episode.description}
            </AppText>
          ) : null}
        </View>
      </Pressable>
      <EpisodeDownloadButton
        episodeId={episode.id}
        episodeTitle={episode.title}
        mediaType={episode.media_type ?? null}
        thumbnailUrl={episode.thumbnail_url}
        category={episode.category_name}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  pressableArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
  },
  artWrap: {
    width: THUMBNAIL_WIDTH,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
  },
  thumbnailFallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.sunken,
  },
  playButtonWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: colors.overlay.chipFill,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  durationText: {
    fontSize: 10,
    lineHeight: 12,
  },
  textBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: TITLE_FONT_SIZE,
    lineHeight: scaledLineHeight(TITLE_FONT_SIZE, 1.2),
  },
  meta: {
    marginTop: 0,
  },
  synopsis: {
    marginTop: spacing.xs,
  },
});

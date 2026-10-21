import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import { AppText, PlatformIcon, ProgressBar } from '../../../../components';
import { darkColors as onArt } from '../../../../theme/colors';
import { useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { fontFamily } from '../../../../theme/typography';
import { formatDuration } from '../../../../lib/format/duration';
import type { ContinueWatchingItem } from '../../../../lib/query/hooks/useContinueWatching';
import type { SeriesPublic } from '../../../../lib/query/hooks/useSeries';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';
import { ArtTile } from './ArtTile';
import { LEAF } from './leaf';

/** A release counts as new for its first week. */
const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export function isNewRelease(publishAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!publishAt) return false;
  const published = new Date(publishAt).getTime();
  return Number.isFinite(published) && now - published >= 0 && now - published < NEW_FOR_MS;
}

/** Title under the art (the art carries it too, but at shelf size it's often cut off),
 * with an optional mono meta line below. */
function Caption({ title, meta }: { title: string; meta?: string | null }) {
  return (
    <View style={styles.caption}>
      <AppText variant="ui.label" numberOfLines={2}>
        {title}
      </AppText>
      {meta ? (
        <AppText variant="mono.meta" tone="tertiary" numberOfLines={1}>
          {meta}
        </AppText>
      ) : null}
    </View>
  );
}

/** "Pick up where you left off": art with the progress line along its foot, then the title and "CATEGORY · 1:58 LEFT". */
export function ResumeCard({ item, onPress }: { item: ContinueWatchingItem; onPress: () => void }) {
  const left =
    item.duration_seconds !== null
      ? `${formatDuration(Math.max(0, item.duration_seconds - item.position_seconds))} LEFT`
      : null;
  const progress = item.percent_complete !== null ? item.percent_complete / 100 : null;
  return (
    <View style={[styles.column, { width: 220 }]}>
      <ArtTile
        thumbnailUrl={item.thumbnail_url}
        onPress={onPress}
        accessibilityLabel={[item.title, left?.toLowerCase()].filter(Boolean).join(', ')}
        width={220}
        aspectRatio={16 / 9}
      >
        {progress !== null ? (
          <View style={styles.progress}>
            <ProgressBar progress={progress} accessibilityLabel={`${Math.round(progress * 100)} percent watched`} height={3} />
          </View>
        ) : null}
      </ArtTile>
      <Caption title={item.title} meta={[item.category_name?.toUpperCase(), left].filter(Boolean).join(' · ')} />
    </View>
  );
}

/** "New releases": wide art, a "New" chip during a release's first week, then the title. */
export function ReleaseCard({ sermon, onPress }: { sermon: SermonListItem; onPress: () => void }) {
  return (
    <View style={[styles.column, { width: 240 }]}>
      <ArtTile thumbnailUrl={sermon.thumbnail_url} onPress={onPress} accessibilityLabel={sermon.title} width={240} aspectRatio={16 / 9}>
        {isNewRelease(sermon.publish_at) ? (
          <View style={styles.newChip} pointerEvents="none">
            <AppText variant="ui.badge" style={styles.newChipText}>
              New
            </AppText>
          </View>
        ) : null}
      </ArtTile>
      <Caption title={sermon.title} />
    </View>
  );
}

/** Prophet's Pick: one large image with a play button, nothing else. */
export function PickCard({ sermon, onPress }: { sermon: SermonListItem; onPress: () => void }) {
  return (
    <ArtTile
      thumbnailUrl={sermon.thumbnail_url}
      onPress={onPress}
      accessibilityLabel={`${sermon.title}, Prophet's Pick`}
      aspectRatio={16 / 9}
      shape={LEAF}
    >
      <View style={styles.pickPlay} pointerEvents="none">
        <PlatformIcon name="play" size={20} color={onArt.primaryButton.text} />
      </View>
    </ArtTile>
  );
}

/** Series grid tile: portrait art, then the title and episode count. */
export function SeriesTile({ series, onPress }: { series: SeriesPublic; onPress: () => void }) {
  const episodes = `${series.episode_count} ${series.episode_count === 1 ? 'episode' : 'episodes'}`;
  return (
    <View style={styles.column}>
      <ArtTile
        thumbnailUrl={series.thumbnail_url}
        onPress={onPress}
        accessibilityLabel={`${series.title}, ${episodes}`}
        aspectRatio={3 / 4}
      />
      <View style={styles.caption}>
        <AppText variant="ui.label" numberOfLines={2}>
          {series.title}
        </AppText>
        <AppText variant="ui.badge" tone="tertiary">
          {episodes}
        </AppText>
      </View>
    </View>
  );
}

/** Prophet's Catalog: square art, then the title. */
export function CatalogCard({ sermon, onPress }: { sermon: SermonListItem; onPress: () => void }) {
  return (
    <View style={[styles.column, { width: 150 }]}>
      <ArtTile thumbnailUrl={sermon.thumbnail_url} onPress={onPress} accessibilityLabel={sermon.title} width={150} aspectRatio={1} />
      <Caption title={sermon.title} />
    </View>
  );
}

/** Recommended for you: a tall image-only poster. */
export function PosterCard({ sermon, onPress }: { sermon: SermonListItem; onPress: () => void }) {
  return <ArtTile thumbnailUrl={sermon.thumbnail_url} onPress={onPress} accessibilityLabel={sermon.title} width={130} aspectRatio={130 / 190} />;
}

const NUMERAL_SIZE = 96;

/** Trending: an outlined gold rank numeral tucked against the poster's edge. */
export function TrendingCard({ rank, sermon, onPress }: { rank: number; sermon: SermonListItem; onPress: () => void }) {
  const { colors } = useTheme();
  const digits = String(rank);
  const numeralWidth = digits.length * 50 + 6;
  return (
    <View style={styles.trending}>
      <View style={styles.numeral} accessible={false} importantForAccessibility="no-hide-descendants">
        <Svg width={numeralWidth} height={NUMERAL_SIZE * 0.85}>
          <SvgText
            x={numeralWidth / 2}
            y={NUMERAL_SIZE * 0.78}
            textAnchor="middle"
            fontSize={NUMERAL_SIZE}
            fontFamily={fontFamily.display}
            fill="none"
            stroke={colors.accent.gold}
            strokeWidth={1.5}
          >
            {digits}
          </SvgText>
        </Svg>
      </View>
      <ArtTile
        thumbnailUrl={sermon.thumbnail_url}
        onPress={onPress}
        accessibilityLabel={`Number ${rank} trending, ${sermon.title}`}
        width={120}
        aspectRatio={120 / 176}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: spacing.sm,
  },
  caption: {
    gap: 2,
  },
  progress: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
  },
  newChip: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: onArt.overlay.chipFill,
  },
  newChipText: {
    color: onArt.accent.goldText,
  },
  pickPlay: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: onArt.primaryButton.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trending: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  numeral: {
    marginRight: -14,
    zIndex: 1,
  },
});

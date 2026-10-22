import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, PlatformIcon, type AppIconName } from '../../../components';
import { DownloadPillButton } from '../../../components/DownloadPillButton';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { useToggleSermonLike, type SermonDetail } from '../../../lib/query/hooks/useSermons';
import { useAddToDefaultLibrary } from '../../../lib/query/hooks/usePlaylists';
import { shareContent } from '../../../lib/share/shareContent';

export interface NowPlayingDetailsProps {
  detail: SermonDetail;
}

/**
 * The Signature player's title block: serif title, speaker · category, then Like, My List,
 * Download and Share as pills — the same actions (and the same hooks) as sermon detail.
 * Download is back on the player at Nii's ask (2026-10-21), as the detail page's own
 * `DownloadPillButton` in its compact skin; a finished download plays from the local file
 * the next time the player opens.
 */
export function NowPlayingDetails({ detail }: NowPlayingDetailsProps) {
  const styles = useStyles();
  const toggleLike = useToggleSermonLike(detail.id);
  const myList = useAddToDefaultLibrary();
  const inMyList = myList.isInDefaultLibrary(detail.id);
  const meta = [detail.speaker_name, detail.category_name].filter(Boolean).join(' · ');

  const onShare = () =>
    void shareContent({
      title: detail.title,
      description: detail.description,
      thumbnailUrl: detail.thumbnail_url,
      deepLinkPath: `sermon/${detail.id}`,
    });

  return (
    <View style={styles.block}>
      <View style={styles.titles}>
        <AppText variant="display.title" accessibilityRole="header">
          {detail.title}
        </AppText>
        {meta ? (
          <AppText variant="ui.body" tone="secondary">
            {meta}
          </AppText>
        ) : null}
      </View>
      <View style={styles.pills}>
        <Pill
          icon={detail.liked_by_me ? 'heart' : 'heart-outline'}
          label={detail.like_count > 0 ? `Like · ${detail.like_count}` : 'Like'}
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
        <Pill
          icon={inMyList ? 'checkmark' : 'add'}
          label="My List"
          accessibilityLabel={inMyList ? 'Remove from My List' : 'Add to My List'}
          selected={inMyList}
          onPress={() => myList.toggleSermon(detail.id)}
        />
        {detail.media_type ? (
          <DownloadPillButton
            compact
            items={[
              {
                sermonId: detail.id,
                title: detail.title,
                mediaType: detail.media_type,
                thumbnailUrl: detail.thumbnail_url,
                category: detail.category_name,
              },
            ]}
          />
        ) : null}
        <Pill icon="share-outline" accessibilityLabel="Share this sermon" onPress={onShare} />
      </View>
    </View>
  );
}

interface PillProps {
  icon: AppIconName;
  /** Omitted for an icon-only pill. */
  label?: string;
  accessibilityLabel: string;
  selected?: boolean;
  onPress: () => void;
}

function Pill({ icon, label, accessibilityLabel, selected = false, onPress }: PillProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tint = selected ? colors.accent.goldText : colors.text.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={spacing.xs}
      style={({ pressed }) => [
        styles.pill,
        !label && styles.iconPill,
        selected && styles.pillSelected,
        pressed && styles.pressed,
      ]}
    >
      <PlatformIcon name={icon} size={15} color={tint} />
      {label ? (
        <AppText variant="ui.label" tone={selected ? 'gold' : 'primary'} numberOfLines={1} style={styles.label}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  block: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  titles: {
    gap: spacing.xs,
  },
  // One line, never wrapping (Nii, 2026-10-22): the pills shrink and their labels truncate
  // before anything drops to a second row, which only happens at large text sizes.
  pills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.xs + 1,
    minHeight: 36,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.card,
  },
  iconPill: {
    width: 36,
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  label: {
    flexShrink: 1,
  },
  pillSelected: {
    borderColor: colors.accent.gold,
  },
  pressed: {
    opacity: 0.7,
  },
}));

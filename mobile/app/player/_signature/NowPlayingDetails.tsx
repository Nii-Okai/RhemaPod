import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, PlatformIcon, type AppIconName } from '../../../components';
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
 * The Signature player's title block: serif title, speaker · category, then Like, My List
 * and Share as pills — the same three actions (and the same hooks) as sermon detail's
 * action row. Download stays off the player (Isaac, 2026-10-09: it duplicated the detail
 * page's own pill), so the mockup's Download pill is left out.
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
      <PlatformIcon name={icon} size={16} color={tint} />
      {label ? (
        <AppText variant="ui.label" tone={selected ? 'gold' : 'primary'}>
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
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: 36,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.card,
  },
  iconPill: {
    width: 36,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  pillSelected: {
    borderColor: colors.accent.gold,
  },
  pressed: {
    opacity: 0.7,
  },
}));

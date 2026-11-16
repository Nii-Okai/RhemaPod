import React from 'react';
import { Pressable, View } from 'react-native';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import type { QueueItemInput } from '../lib/playback/queue';
import { PlatformIcon, type AppIconName } from './PlatformIcon';
import { Sheet } from './Sheet';
import { AppText } from './Text';

export interface QueueMenuSheetProps {
  /** The sermon the sheet is for; `null` keeps it closed. */
  item: QueueItemInput | null;
  onClose: () => void;
  onPlayNext: (item: QueueItemInput) => void;
  onAddToQueue: (item: QueueItemInput) => void;
}

/**
 * Play next / Add to queue for one sermon, opened by a long press on its row anywhere in
 * the app (`NowPlayingProvider` draws the one copy). Rows also offer both as accessibility
 * actions, so the sheet is never the only way in for VoiceOver or TalkBack.
 */
export function QueueMenuSheet({ item, onClose, onPlayNext, onAddToQueue }: QueueMenuSheetProps) {
  if (!item) return null;
  return <QueueMenuBody item={item} onClose={onClose} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} />;
}

function QueueMenuBody({ item, onClose, onPlayNext, onAddToQueue }: QueueMenuSheetProps & { item: QueueItemInput }) {
  const styles = useStyles();
  return (
    <Sheet visible onClose={onClose}>
      <AppText variant="ui.bodyBold" numberOfLines={2} style={styles.title}>
        {item.title}
      </AppText>
      <View>
        <Row
          icon="play-skip-forward-outline"
          label="Play next"
          onPress={() => {
            onPlayNext(item);
            onClose();
          }}
        />
        <Row
          icon="list"
          label="Add to queue"
          onPress={() => {
            onAddToQueue(item);
            onClose();
          }}
        />
      </View>
    </Sheet>
  );
}

function Row({ icon, label, onPress }: { icon: AppIconName; label: string; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <PlatformIcon name={icon} size={20} color={colors.text.primary} />
      <AppText variant="ui.bodyLarge">{label}</AppText>
    </Pressable>
  );
}

const useStyles = createThemedStyles(() => ({
  title: {
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
}));

import React, { useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, PressableScale, QueryState, StaggerItem } from '../../../components';
import { useDeviceClass } from '../../../components/navigation/useDeviceClass';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { sortPinnedFirst } from '../../../lib/format/pinnedFirst';
import { useAnnouncements, type AnnouncementListItem } from '../../../lib/query/hooks/useAnnouncements';
import { Flame } from '../_home/signature/Flame';
import { LEAF, LEAF_SM } from '../_home/signature/leaf';
import { formatAnnouncementWhen } from './announcementWhen';
import { usePullToRefresh } from '../../../lib/hooks/usePullToRefresh';

/** Past this many characters a description starts clamped, with "Read more" to open it. */
const LONG_DESCRIPTION = 140;
const CLAMPED_LINES = 3;

/**
 * Poster art. Church posters come in every shape and carry their dates, speakers and
 * phone numbers in the artwork, so nothing is cropped: the whole poster sits in a 16:9
 * frame over a blurred copy of itself, and a tap opens it full screen.
 */
function PosterArt({ uri, title, onOpen }: { uri: string; title: string; onOpen: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={`View poster: ${title}`} style={styles.art}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={24} />
      <View style={styles.artDim} pointerEvents="none" />
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
    </Pressable>
  );
}

function AnnouncementCard({
  announcement,
  onOpenPoster,
}: {
  announcement: AnnouncementListItem;
  onOpenPoster: (announcement: AnnouncementListItem) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { pinned, description } = announcement;
  const when = formatAnnouncementWhen(announcement);
  const long = (description?.length ?? 0) > LONG_DESCRIPTION;

  const text = (
    <View style={styles.cardText}>
      <View style={styles.whenRow}>
        <Flame width={8} fill={pinned ? colors.accent.gold : colors.text.tertiary} />
        <AppText variant="mono.meta" tone={pinned ? 'gold' : 'tertiary'} numberOfLines={1} style={styles.whenText}>
          {[pinned ? 'PINNED' : null, when].filter(Boolean).join('  ·  ')}
        </AppText>
      </View>
      <AppText variant="display.row" numberOfLines={3}>
        {announcement.title}
      </AppText>
      {description ? (
        <AppText variant="ui.body" tone="secondary" numberOfLines={long && !expanded ? CLAMPED_LINES : undefined}>
          {description}
        </AppText>
      ) : null}
      {long ? (
        <AppText variant="ui.label" tone="gold">
          {expanded ? 'Show less' : 'Read more'}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.card, pinned ? styles.pinnedCard : styles.standardCard]} accessibilityRole="summary">
      {announcement.image_url ? (
        <PosterArt uri={announcement.image_url} title={announcement.title} onOpen={() => onOpenPoster(announcement)} />
      ) : null}
      {long ? (
        <PressableScale
          onPress={() => setExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityHint={expanded ? 'Shows less' : 'Shows the full announcement'}
        >
          {text}
        </PressableScale>
      ) : (
        text
      )}
    </View>
  );
}

/** Full-screen poster, so the details printed on it can be read. */
function PosterViewer({ announcement, onClose }: { announcement: AnnouncementListItem | null; onClose: () => void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={announcement !== null} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.viewerBar}>
          <IconButton icon="close" accessibilityLabel="Close poster" onPress={onClose} />
        </View>
        {announcement?.image_url ? (
          <Image
            source={{ uri: announcement.image_url }}
            style={styles.viewerImage}
            resizeMode="contain"
            accessibilityLabel={`Poster: ${announcement.title}`}
          />
        ) : null}
        {announcement ? (
          <AppText variant="display.row" numberOfLines={2} style={styles.viewerTitle}>
            {announcement.title}
          </AppText>
        ) : null}
      </View>
    </Modal>
  );
}

function Section({
  label,
  items,
  offset,
  onOpenPoster,
}: {
  label: string | null;
  items: AnnouncementListItem[];
  offset: number;
  onOpenPoster: (announcement: AnnouncementListItem) => void;
}) {
  const styles = useStyles();
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      {label ? (
        <AppText variant="mono.meta" tone="tertiary" accessibilityRole="header">
          {label.toUpperCase()}
        </AppText>
      ) : null}
      {items.map((announcement, index) => (
        <StaggerItem key={announcement.id} index={offset + index}>
          <AnnouncementCard announcement={announcement} onOpenPoster={onOpenPoster} />
        </StaggerItem>
      ))}
    </View>
  );
}

/**
 * Announcements, Signature redesign (Nii's ask, 2026-10-22: "feel free to redesign
 * announcement screen"), behind `SIGNATURE_ANNOUNCEMENTS_ENABLED`. Same data as the
 * classic screen — `useAnnouncements()` with the defensive pinned-first re-sort, no
 * client-side date filtering — laid out as a Signature page: a large display title with a
 * live count, "Pinned" then "Latest" sections (labels only when both have items), and
 * leaf-cornered cards whose posters are shown whole and open full screen. Pinned cards
 * take the wheat tint and a gold flame. Every colour comes from the active theme.
 */
export function SignatureAnnouncementsScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isTablet = useDeviceClass() === 'tablet';
  const announcements = useAnnouncements();
  const [poster, setPoster] = useState<AnnouncementListItem | null>(null);

  const items = sortPinnedFirst(announcements.data ?? []);
  const pinned = items.filter((item) => item.pinned);
  const latest = items.filter((item) => !item.pinned);
  const labelled = pinned.length > 0 && latest.length > 0;

  const pullToRefresh = usePullToRefresh([announcements]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        {isTablet ? null : (
          <View style={styles.headerBar}>
            <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          </View>
        )}
        <View style={styles.titleRow}>
          <AppText variant="display.hero" accessibilityRole="header">
            Announcements
          </AppText>
          {items.length > 0 ? (
            <AppText variant="mono.meta" tone="gold">
              {`${items.length} LIVE`}
            </AppText>
          ) : null}
        </View>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...pullToRefresh} />
        }
      >
        <QueryState
          isLoading={announcements.isLoading}
          isError={announcements.isError}
          error={announcements.error}
          isEmpty={!announcements.isLoading && !announcements.isError && items.length === 0}
          emptyTitle="No announcements right now"
          emptyDescription="Check back soon."
          onRetry={() => announcements.refetch()}
          loadingLabel="Loading announcements"
        >
          <View style={styles.body}>
            <Section label={labelled ? 'Pinned' : null} items={pinned} offset={0} onOpenPoster={setPoster} />
            <Section label={labelled ? 'Latest' : null} items={latest} offset={pinned.length} onOpenPoster={setPoster} />
          </View>
        </QueryState>
      </ScrollView>
      <PosterViewer announcement={poster} onClose={() => setPoster(null)} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md - 2,
    paddingHorizontal: spacing.md,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl * 2,
  },
  body: {
    gap: spacing.xxl,
  },
  section: {
    gap: spacing.lg,
  },
  card: {
    ...LEAF_SM,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  standardCard: {
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
  },
  pinnedCard: {
    ...LEAF,
    backgroundColor: colors.status.wheat.bg,
    borderColor: colors.status.wheat.border,
  },
  art: {
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  artDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.sunken,
    opacity: 0.45,
  },
  cardText: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  whenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
  },
  whenText: {
    flexShrink: 1,
  },
  viewer: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  viewerBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xs,
  },
  viewerImage: {
    flex: 1,
    width: '100%',
  },
  viewerTitle: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    textAlign: 'center',
  },
}));

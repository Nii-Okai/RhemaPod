import React, { useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, IconButton, PlatformIcon, QueryState, StaggerItem } from '../../../components';
import { useDeviceClass } from '../../../components/navigation/useDeviceClass';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { sortPinnedFirst } from '../../../lib/format/pinnedFirst';
import { useAnnouncements, type AnnouncementListItem } from '../../../lib/query/hooks/useAnnouncements';
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

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The weekday-over-day tile on a news card (canvas B8), from when it goes live. */
function dateTileFor(announcement: AnnouncementListItem): { weekday: string; day: string } | null {
  const iso = announcement.publish_at ?? announcement.created_at;
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return { weekday: WEEKDAYS[date.getDay()], day: String(date.getDate()) };
}

function AnnouncementCard({
  announcement,
  index,
  onOpenPoster,
}: {
  announcement: AnnouncementListItem;
  index: number;
  onOpenPoster: (announcement: AnnouncementListItem) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { pinned, description } = announcement;
  const when = formatAnnouncementWhen(announcement);
  const long = (description?.length ?? 0) > LONG_DESCRIPTION;
  const tile = pinned ? null : dateTileFor(announcement);
  // Alternate the tile's wash so a run of cards doesn't read as one block.
  const sage = index % 2 === 1;

  const readMore = long ? (
    <Pressable
      onPress={() => setExpanded((open) => !open)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityHint={expanded ? 'Shows less' : 'Shows the full announcement'}
      hitSlop={spacing.xs}
    >
      <AppText variant="ui.label" style={pinned ? styles.pinnedLink : styles.link}>
        {expanded ? 'Show less' : 'Read more'}
      </AppText>
    </Pressable>
  ) : null;

  if (pinned) {
    // The pinned item is the navy feature card with a sun in its corner.
    return (
      <View style={styles.pinnedCard} accessibilityRole="summary">
        <View style={styles.sun} pointerEvents="none" />
        {announcement.image_url ? (
          <PosterArt uri={announcement.image_url} title={announcement.title} onOpen={() => onOpenPoster(announcement)} />
        ) : null}
        <View style={styles.pinnedText}>
          <View style={styles.whenRow}>
            <PlatformIcon name="megaphone-outline" size={14} color={colors.feature.sun} />
            <AppText variant="ui.badge" numberOfLines={1} style={styles.pinnedEyebrow}>
              {['PINNED', when].filter(Boolean).join(' · ')}
            </AppText>
          </View>
          <AppText variant="display.section" numberOfLines={3} style={styles.pinnedTitle}>
            {announcement.title}
          </AppText>
          {description ? (
            <AppText variant="ui.body" numberOfLines={long && !expanded ? CLAMPED_LINES : undefined} style={styles.pinnedBody}>
              {description}
            </AppText>
          ) : null}
          <View style={styles.pinnedActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Share.share({ message: [announcement.title, description].filter(Boolean).join('\n\n') })}
              style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
            >
              <AppText variant="ui.button" style={styles.shareText}>
                Share
              </AppText>
            </Pressable>
            {readMore}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityRole="summary">
      {announcement.image_url ? (
        <PosterArt uri={announcement.image_url} title={announcement.title} onOpen={() => onOpenPoster(announcement)} />
      ) : null}
      <View style={styles.cardRow}>
        {tile ? (
          <View style={[styles.tile, sage ? styles.tileSage : styles.tileIris]}>
            <AppText variant="ui.badge" style={sage ? styles.tileTextSage : styles.tileTextIris}>
              {tile.weekday}
            </AppText>
            <AppText variant="display.row" style={sage ? styles.tileTextSage : styles.tileTextIris}>
              {tile.day}
            </AppText>
          </View>
        ) : null}
        <View style={styles.cardText}>
          <AppText variant="ui.bodyBold" numberOfLines={3} style={styles.cardTitle}>
            {announcement.title}
          </AppText>
          {description ? (
            <AppText variant="ui.body" tone="secondary" numberOfLines={long && !expanded ? CLAMPED_LINES : undefined}>
              {description}
            </AppText>
          ) : null}
          {when ? (
            <AppText variant="ui.badge" tone="tertiary" numberOfLines={1}>
              {when}
            </AppText>
          ) : null}
          {readMore}
        </View>
      </View>
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
        <AppText variant="ui.badge" tone="tertiary" accessibilityRole="header" style={styles.eyebrow}>
          {label.toUpperCase()}
        </AppText>
      ) : null}
      {items.map((announcement, index) => (
        <StaggerItem key={announcement.id} index={offset + index}>
          <AnnouncementCard announcement={announcement} index={index} onOpenPoster={onOpenPoster} />
        </StaggerItem>
      ))}
    </View>
  );
}

/**
 * Daybreak redesign (canvas B8): round back button, "This week at church" over the
 * title with a green live count, the pinned item as the navy card with a sun in its
 * corner and a gold Share button, the rest as white cards with a weekday-and-day tile.
 *
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
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
        {/* Back sits on the title's row (Nii, 2026-11-11); the LIVE pill moves up beside
            the eyebrow to leave the title its width. */}
        <View style={styles.titleRow}>
          {isTablet ? null : (
            <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          )}
          <View style={styles.titles}>
            <View style={styles.eyebrowRow}>
              <AppText variant="ui.badge" tone="tertiary" style={styles.eyebrow}>
                THIS WEEK AT CHURCH
              </AppText>
              {items.length > 0 ? (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <AppText variant="ui.badge" style={styles.liveText}>
                    {`${items.length} LIVE`}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="display.hero" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>
              Announcements
            </AppText>
          </View>
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
    paddingHorizontal: spacing.lg + 4,
    paddingBottom: spacing.sm,
    gap: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  titles: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  eyebrow: {
    letterSpacing: 1.5,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: colors.status.sage.bg,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.status.sage.text,
  },
  liveText: {
    color: colors.status.sage.text,
    letterSpacing: 0.6,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  body: {
    gap: spacing.xl,
  },
  section: {
    gap: spacing.md + 2,
  },
  pressed: {
    opacity: 0.85,
  },
  pinnedCard: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: colors.feature.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.feature.border,
  },
  sun: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    right: -30,
    top: -30,
    backgroundColor: colors.feature.sun,
  },
  pinnedText: {
    padding: spacing.xl,
    gap: spacing.sm + 2,
  },
  pinnedEyebrow: {
    color: colors.feature.sun,
    letterSpacing: 1.5,
    flexShrink: 1,
  },
  pinnedTitle: {
    color: colors.feature.text,
    maxWidth: 260,
  },
  pinnedBody: {
    color: colors.feature.muted,
  },
  pinnedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  shareButton: {
    height: 44,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: colors.sunButton.bg,
  },
  shareText: {
    color: colors.sunButton.text,
  },
  pinnedLink: {
    color: colors.feature.text,
  },
  link: {
    color: colors.accent.goldText,
  },
  card: {
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md + 2,
    padding: spacing.lg,
  },
  tile: {
    width: 52,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIris: {
    backgroundColor: colors.iris.soft,
  },
  tileSage: {
    backgroundColor: colors.status.sage.bg,
  },
  tileTextIris: {
    color: colors.iris.ink,
  },
  tileTextSage: {
    color: colors.status.sage.text,
  },
  cardText: {
    flex: 1,
    gap: 6,
  },
  cardTitle: {
    color: colors.text.primary,
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
  whenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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

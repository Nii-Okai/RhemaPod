import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Avatar } from '../../components';
import { useDeviceClass } from '../../components/navigation';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useAuth } from '../../lib/auth/AuthContext';
import { useCurrentUser } from '../../lib/query/hooks/useProfile';
import { useMyNotes } from '../../lib/query/hooks/useNotes';
import { useSermons } from '../../lib/query/hooks/useSermons';
import { buildSermonTitleMap } from '../../lib/format/sermonTitleMap';
import { usePlaybackPreferences } from '../../lib/settings/usePlaybackPreferences';
import type { PlaybackSpeed } from '../../lib/settings/playbackPreferences';
import { LibraryRow } from './_me/LibraryRow';
import { PlaybackSection } from './_me/PlaybackSection';
import { NotesPanel } from './_me/NotesPanel';

const PLAYBACK_SAVE_ERROR = "Couldn't save your playback settings. Try again.";

/**
 * Profile & Settings (design spec 1n minus membership, plan W4.6). Cuts from the source
 * kept out on purpose: no "Annual membership" block (L1), no notify-on-publish toggle
 * (L5 — push is cut entirely, "a dead toggle is worse than no toggle"), no Library
 * counts (P8 — "24"/"96" would need an unbuilt paginated-count contract).
 *
 * Tablet (>=768pt, `useDeviceClass`): two-pane per design spec 1o's rail-nav-plus-panel
 * shape, scoped here to what this screen actually owns — see `_me/NotesPanel.tsx`'s own
 * docstring for the explicit boundary against 1o's (unbuilt, W4.2) docked video pane.
 */
export default function MeScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const deviceClass = useDeviceClass();

  const profileQuery = useCurrentUser();
  const notesQuery = useMyNotes();
  const sermonsQuery = useSermons();
  const { preferences, isSaving, setDefaultSpeed, setAutoplayNextInSeries } = usePlaybackPreferences();
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);

  const sermonTitles = buildSermonTitleMap(sermonsQuery.data ?? []);

  const handleChangeSpeed = (speed: PlaybackSpeed) => {
    setPlaybackError(null);
    setDefaultSpeed(speed).catch(() => setPlaybackError(PLAYBACK_SAVE_ERROR));
  };

  const handleChangeAutoplay = (enabled: boolean) => {
    setPlaybackError(null);
    setAutoplayNextInSeries(enabled).catch(() => setPlaybackError(PLAYBACK_SAVE_ERROR));
  };

  const settingsContent = (
    <>
      <View style={styles.header}>
        {profileQuery.isLoading ? (
          <AppText variant="ui.body" tone="secondary">
            Loading profile…
          </AppText>
        ) : profileQuery.isError || !profileQuery.data ? (
          <AppText variant="ui.body" tone="secondary">
            Couldn't load your profile.
          </AppText>
        ) : (
          <>
            <Avatar name={profileQuery.data.full_name || profileQuery.data.email} seed={profileQuery.data.id} size={40} />
            <View style={styles.headerText}>
              <AppText variant="display.row">{profileQuery.data.full_name || profileQuery.data.email}</AppText>
              <AppText variant="ui.body" tone="secondary">
                {profileQuery.data.email}
              </AppText>
            </View>
          </>
        )}
      </View>

      <PlaybackSection
        defaultSpeed={preferences.defaultSpeed}
        autoplayNextInSeries={preferences.autoplayNextInSeries}
        onChangeSpeed={handleChangeSpeed}
        onChangeAutoplay={handleChangeAutoplay}
        disabled={isSaving}
        error={playbackError}
      />

      <View style={styles.section}>
        <AppText variant="ui.label" tone="tertiary" style={styles.sectionHeading}>
          Library
        </AppText>
        <LibraryRow label="Notes" onPress={() => router.push('/notes')} />
        <LibraryRow label="History" onPress={() => router.push('/history')} />
      </View>

      <View style={styles.section}>
        <LibraryRow label="Announcements" onPress={() => router.push('/(tabs)/announcements')} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void signOut()}
        style={styles.signOutRow}
      >
        <AppText variant="ui.bodyLarge" style={styles.signOutText}>
          Sign out
        </AppText>
      </Pressable>
    </>
  );

  if (deviceClass === 'tablet') {
    return (
      <View style={styles.tabletLayout} testID="me-tablet-layout">
        <ScrollView style={styles.tabletLeftPane} contentContainerStyle={styles.content}>
          {settingsContent}
        </ScrollView>
        <NotesPanel
          notes={notesQuery.data ?? []}
          sermonTitles={sermonTitles}
          isLoading={notesQuery.isLoading}
          isError={notesQuery.isError}
          onSeeAll={() => router.push('/notes')}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="me-phone-layout">
      {settingsContent}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  tabletLayout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface.app,
  },
  tabletLeftPane: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    gap: spacing.xs,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeading: {
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  signOutRow: {
    paddingVertical: spacing.md,
  },
  signOutText: {
    color: colors.status.rose.text,
  },
});

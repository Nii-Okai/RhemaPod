import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Avatar } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useAuth } from '../../lib/auth/AuthContext';
import { useCurrentUser } from '../../lib/query/hooks/useProfile';
import { previewDisplayName } from '../../lib/format/displayName';
import { CONTACT_EMAIL, isComplianceContentPending } from '../../lib/content/commentsCompliance';
import { usePlaybackPreferences } from '../../lib/settings/usePlaybackPreferences';
import type { PlaybackSpeed } from '../../lib/settings/playbackPreferences';
import { LibraryRow } from './_me/LibraryRow';
import { PlaybackSection } from './_me/PlaybackSection';
import { NamePrompt } from '../player/_comments/NamePrompt';
import { TermsSheet } from '../player/_comments/TermsSheet';

const PLAYBACK_SAVE_ERROR = "Couldn't save your playback settings. Try again.";

/**
 * Profile & Settings (design spec 1n minus membership, plan W4.6). Cuts from the source
 * kept out on purpose: no "Annual membership" block (L1), no notify-on-publish toggle
 * (L5 — push is cut entirely, "a dead toggle is worse than no toggle"), no Library
 * counts (P8 — "24"/"96" would need an unbuilt paginated-count contract).
 *
 * Sermon comments (plan S13, design spec comments-and-player §3) add: a name row that
 * edits `full_name` (shown to other viewers as "First L." on comments), a Blocked users
 * row, and a "Help and safety" section with the published contact address and the comment
 * guidelines. One column on every device width: the tablet two-pane existed only to dock
 * the Notes panel, which is gone with Notes.
 */
export default function MeScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  const profileQuery = useCurrentUser();
  const { preferences, isSaving, setDefaultSpeed, setAutoplayNextInSeries } = usePlaybackPreferences();
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);

  const [nameSheetOpen, setNameSheetOpen] = React.useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = React.useState(false);
  const [nameUpdated, setNameUpdated] = React.useState(false);

  const profile = profileQuery.data;
  const currentName = (profile?.full_name ?? '').trim();
  const publicName = previewDisplayName(currentName);
  const contactPending = isComplianceContentPending(CONTACT_EMAIL);

  const handleChangeSpeed = (speed: PlaybackSpeed) => {
    setPlaybackError(null);
    setDefaultSpeed(speed).catch(() => setPlaybackError(PLAYBACK_SAVE_ERROR));
  };

  const handleChangeAutoplay = (enabled: boolean) => {
    setPlaybackError(null);
    setAutoplayNextInSeries(enabled).catch(() => setPlaybackError(PLAYBACK_SAVE_ERROR));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="me-layout">
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

      {profile ? (
        <View style={styles.section}>
          <LibraryRow
            label="Name"
            detail={currentName || 'Add your name'}
            onPress={() => {
              setNameUpdated(false);
              setNameSheetOpen(true);
            }}
          />
          {nameUpdated ? (
            <AppText variant="ui.badge" tone="secondary" accessibilityLiveRegion="polite">
              Name updated.
            </AppText>
          ) : null}
          {publicName ? (
            <AppText variant="ui.badge" tone="tertiary">
              {`Shown as '${publicName}' on comments.`}
            </AppText>
          ) : null}
        </View>
      ) : null}

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
        <LibraryRow label="Blocked users" onPress={() => router.push('/blocked-users')} />
        <LibraryRow label="History" onPress={() => router.push('/history')} />
      </View>

      <View style={styles.section}>
        <LibraryRow label="Announcements" onPress={() => router.push('/(tabs)/announcements')} />
      </View>

      <View style={styles.section}>
        <AppText variant="ui.label" tone="tertiary" style={styles.sectionHeading}>
          Help and safety
        </AppText>
        <LibraryRow
          label="Contact us"
          detail={CONTACT_EMAIL}
          accessibilityLabel={`Contact us at ${CONTACT_EMAIL}`}
          hideChevron
          onPress={() => {
            // A placeholder (Isaac's input I1 not yet supplied) must never become a mailto: link.
            if (!contactPending) void Linking.openURL(`mailto:${CONTACT_EMAIL}`);
          }}
        />
        <LibraryRow label="Comment guidelines" onPress={() => setGuidelinesOpen(true)} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void signOut()}
        style={({ pressed }) => [styles.signOutRow, pressed && styles.signOutRowPressed]}
      >
        <AppText variant="ui.bodyLarge" style={styles.signOutText}>
          Sign out
        </AppText>
      </Pressable>

      <NamePrompt
        visible={nameSheetOpen}
        initialName={currentName}
        title="Your name"
        saveLabel="Save"
        onClose={() => setNameSheetOpen(false)}
        onSaved={() => {
          setNameSheetOpen(false);
          setNameUpdated(true);
        }}
      />
      <TermsSheet visible={guidelinesOpen} readOnly onClose={() => setGuidelinesOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
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
  signOutRowPressed: {
    opacity: 0.7,
  },
  signOutText: {
    color: colors.status.rose.text,
  },
});

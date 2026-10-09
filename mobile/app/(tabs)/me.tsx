import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Card, LinkButton } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useAuth } from '../../lib/auth/AuthContext';
import { useCurrentUser } from '../../lib/query/hooks/useProfile';
import { previewDisplayName } from '../../lib/format/displayName';
import { CONTACT_EMAIL, isComplianceContentPending } from '../../lib/content/commentsCompliance';
import { usePlaybackPreferences } from '../../lib/settings/usePlaybackPreferences';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { DownloadsSection } from './_me/DownloadsSection';
import { LibraryRow } from './_me/LibraryRow';
import { PlaybackSection } from './_me/PlaybackSection';
import { ProfileAvatarPicker } from './_me/ProfileAvatarPicker';
import { ProfileDetailsSheet } from './_me/ProfileDetailsSheet';
import { TermsSheet } from '../player/_comments/TermsSheet';

const PLAYBACK_SAVE_ERROR = "Couldn't save your playback settings. Try again.";

/**
 * Profile & Settings (design spec 1n minus membership, plan W4.6). Cuts from the source
 * kept out on purpose: no "Annual membership" block (L1), no notify-on-publish toggle
 * (L5 — push is cut entirely, "a dead toggle is worse than no toggle"), no Library
 * counts (P8 — "24"/"96" would need an unbuilt paginated-count contract).
 *
 * Sermon comments (plan S13, design spec comments-and-player §3) add: a profile editor
 * that writes `full_name` (shown to other viewers as "First L." on comments), a Blocked
 * users row, and a "Help and safety" section with the published contact address and the
 * comment guidelines.
 *
 * Redesigned session 2026-10-09 (Isaac's asks):
 *  - A real profile picture (`ProfileAvatarPicker`, tap the hero avatar) and a
 *    first/last-name + gender editor (`ProfileDetailsSheet`) replace the old single
 *    "Name" row + `NamePrompt` combo — that sheet is untouched and still owns the
 *    comments flow's own pre-first-post name prompt, a separate screen entirely.
 *  - Top padding starts at `insets.top`, below the notch/Dynamic Island.
 *  - Each settings group is a `Card` now — "make the page more organized" — instead of
 *    bare, visually-undifferentiated sections.
 *  - Downloads' own Wi-Fi-only toggle lives here too (session 2026-10-09, same day —
 *    the Downloads tab's dedicated settings page is retired in favor of this one
 *    consolidated screen).
 *  - Playback's default-speed picker is gone (Isaac's ask) — the Player screen's own
 *    in-session speed control already covers it; see `PlaybackSection`'s own doc
 *    comment.
 *
 * One column on every device width: the tablet two-pane existed only to dock the Notes
 * panel, which is gone with Notes.
 */
export default function MeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();

  const profileQuery = useCurrentUser();
  const { preferences, isSaving, setAutoplayNextInSeries } = usePlaybackPreferences();
  const { wifiOnly, isSavingWifiOnly, setWifiOnly } = useDownloads();
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);

  const [detailsSheetOpen, setDetailsSheetOpen] = React.useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = React.useState(false);
  const [profileUpdated, setProfileUpdated] = React.useState(false);

  const profile = profileQuery.data;
  const currentName = (profile?.full_name ?? '').trim();
  const publicName = previewDisplayName(currentName);
  const contactPending = isComplianceContentPending(CONTACT_EMAIL);

  const handleChangeAutoplay = (enabled: boolean) => {
    setPlaybackError(null);
    setAutoplayNextInSeries(enabled).catch(() => setPlaybackError(PLAYBACK_SAVE_ERROR));
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.lg) }]}
      testID="me-layout"
    >
      <View style={styles.header}>
        {profileQuery.isLoading ? (
          <AppText variant="ui.body" tone="secondary">
            Loading profile…
          </AppText>
        ) : profileQuery.isError || !profile ? (
          <AppText variant="ui.body" tone="secondary">
            Couldn't load your profile.
          </AppText>
        ) : (
          <>
            <ProfileAvatarPicker
              name={profile.full_name || profile.email}
              seed={profile.id}
              avatarUrl={profile.avatar_url ?? null}
            />
            <View style={styles.headerText}>
              <AppText variant="display.row">{profile.full_name || profile.email}</AppText>
              <AppText variant="ui.body" tone="secondary">
                {profile.email}
              </AppText>
              <View style={styles.editProfileLink}>
                <LinkButton label="Edit profile" onPress={() => setDetailsSheetOpen(true)} />
              </View>
            </View>
          </>
        )}
      </View>

      {profile ? (
        <View style={styles.section}>
          {profileUpdated ? (
            <AppText variant="ui.badge" tone="secondary" accessibilityLiveRegion="polite">
              Profile updated.
            </AppText>
          ) : null}
          {publicName ? (
            <AppText variant="ui.badge" tone="tertiary">
              {`Shown as '${publicName}' on comments.`}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <Card style={styles.card}>
        <PlaybackSection
          autoplayNextInSeries={preferences.autoplayNextInSeries}
          onChangeAutoplay={handleChangeAutoplay}
          disabled={isSaving}
          error={playbackError}
        />
      </Card>

      <Card style={styles.card}>
        <DownloadsSection
          wifiOnly={wifiOnly}
          onChangeWifiOnly={(enabled) => {
            void setWifiOnly(enabled);
          }}
          disabled={isSavingWifiOnly}
        />
      </Card>

      <Card style={styles.card}>
        <AppText variant="ui.label" tone="tertiary" style={styles.sectionHeading}>
          Library
        </AppText>
        <LibraryRow label="Blocked users" onPress={() => router.push('/blocked-users')} />
        <LibraryRow label="History" onPress={() => router.push('/history')} />
        <LibraryRow label="Announcements" onPress={() => router.push('/(tabs)/announcements')} />
      </Card>

      <Card style={styles.card}>
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
      </Card>

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

      <ProfileDetailsSheet
        visible={detailsSheetOpen}
        initialFirstName={profile?.first_name ?? ''}
        initialLastName={profile?.last_name ?? ''}
        initialGender={profile?.gender ?? null}
        onClose={() => setDetailsSheetOpen(false)}
        onSaved={() => {
          setDetailsSheetOpen(false);
          setProfileUpdated(true);
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
    flex: 1,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  editProfileLink: {
    marginTop: spacing.xs,
  },
  section: {
    gap: spacing.xs,
  },
  card: {
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

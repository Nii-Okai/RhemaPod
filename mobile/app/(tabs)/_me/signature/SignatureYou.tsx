import React from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PlatformIcon, Toggle, type AppIconName } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { useAuth } from '../../../../lib/auth/AuthContext';
import { displayEmail } from '../../../../lib/auth/displayEmail';
import { useCurrentUser } from '../../../../lib/query/hooks/useProfile';
import { previewDisplayName } from '../../../../lib/format/displayName';
import { isComplianceContentPending } from '../../../../lib/content/commentsCompliance';
import { useChurchContent } from '../../../../lib/query/hooks/useChurchSettings';
import { usePlaybackPreferences } from '../../../../lib/settings/usePlaybackPreferences';
import { useDownloads } from '../../../../lib/downloads/useDownloads';
import { TermsSheet } from '../../../player/_comments/TermsSheet';
import { LEAF_SM } from '../../_home/signature/leaf';
import { useJournal } from '../../../../lib/query/hooks/useDevotionals';
import { usePlaylists } from '../../../../lib/query/hooks/usePlaylists';
import { pathnameFor, routeByKey } from '../../../../components/navigation/routes';
import { ProfileAvatarPicker } from '../ProfileAvatarPicker';
import { ProfileDetailsSheet } from '../ProfileDetailsSheet';
import { ThemeSwitch } from './ThemeSwitch';
import { usePullToRefresh } from '../../../../lib/hooks/usePullToRefresh';
import { formatCacheSize, useMediaCacheUsage } from '../../../../lib/mediaCache/useMediaCacheUsage';

const PLAYBACK_SAVE_ERROR = "Couldn't save your playback settings. Try again.";
const AVATAR_SIZE = 64;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <AppText variant="mono.meta" tone="tertiary" accessibilityRole="header">
        {label.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

/** A rounded panel of rows, each divided from the next by a hairline. */
function Panel({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.panel}>
      {rows.map((row, index) => (
        <View key={index} style={index < rows.length - 1 ? styles.divided : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

function ToggleRow({
  label,
  detail,
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  detail: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <AppText variant="ui.bodyLarge">{label}</AppText>
        <AppText variant="ui.body" tone="tertiary">
          {detail}
        </AppText>
      </View>
      <Toggle value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={accessibilityLabel} />
    </View>
  );
}

function LinkRow({
  icon,
  label,
  detail,
  onPress,
  accessibilityLabel,
}: {
  icon: AppIconName;
  label: string;
  detail?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <PlatformIcon name={icon} size={20} color={colors.accent.goldText} />
      <View style={styles.rowText}>
        <AppText variant="ui.bodyLarge">{label}</AppText>
        {detail ? (
          <AppText variant="ui.body" tone="tertiary">
            {detail}
          </AppText>
        ) : null}
      </View>
      <PlatformIcon name="chevron-forward" size={18} color={colors.text.tertiary} />
    </Pressable>
  );
}

/**
 * You, Signature redesign (Nii's approved mockup "RhemaPod — Signature", 2026-10-21),
 * behind `SIGNATURE_YOU_ENABLED`. Every setting the classic `me.tsx` has, nothing new
 * (Nii: "keep every existing setting"), regrouped as the mockup draws it:
 *
 *  - a profile card: the tappable photo (gold ring), name, email, how the name shows on
 *    comments, and Edit profile;
 *  - Appearance as one three-way switch (`ThemeSwitch`);
 *  - Playback & downloads: autoplay next in series and Wi-Fi-only downloads;
 *  - Library: Announcements and Blocked users;
 *  - Help & safety: Contact us;
 *  - Legal: Privacy policy and Terms of use once their links are set, and Community guidelines;
 *  - Account: Delete account (`app/delete-account.tsx`);
 *  - Sign out.
 */
export function SignatureYouScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();

  const profileQuery = useCurrentUser();
  const pullToRefresh = usePullToRefresh([profileQuery]);
  const { preferences, isSaving, setAutoplayNextInSeries } = usePlaybackPreferences();
  const { wifiOnly, isSavingWifiOnly, setWifiOnly } = useDownloads();
  const playCache = useMediaCacheUsage();
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);
  const [appearanceError, setAppearanceError] = React.useState<string | null>(null);

  const [detailsSheetOpen, setDetailsSheetOpen] = React.useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = React.useState(false);
  const [profileUpdated, setProfileUpdated] = React.useState(false);

  const { journal } = useJournal();
  const playlists = usePlaylists();
  const keptWords = Object.values(journal ?? {}).filter((entry) => entry.completedAt && entry.word).length;
  const playlistCount = playlists.data?.length ?? 0;

  const profile = profileQuery.data;
  const publicName = previewDisplayName((profile?.full_name ?? '').trim());
  // Server values when available; the shipped constants otherwise (offline, error, first launch).
  const { contactEmail, termsOfUseUrl, privacyPolicyUrl } = useChurchContent();
  const contactPending = isComplianceContentPending(contactEmail);

  const handleChangeAutoplay = (enabled: boolean) => {
    setPlaybackError(null);
    setAutoplayNextInSeries(enabled).catch(() => setPlaybackError(PLAYBACK_SAVE_ERROR));
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.lg) + spacing.sm }]}
      testID="me-layout"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pullToRefresh} />}
    >
      <AppText variant="display.hero" accessibilityRole="header">
        You
      </AppText>

      <View style={styles.profileCard}>
        <View style={styles.profileOrb} pointerEvents="none" />
        {profileQuery.isLoading ? (
          <AppText variant="ui.body" style={styles.onFeatureMuted}>
            Loading profile…
          </AppText>
        ) : profileQuery.isError || !profile ? (
          <AppText variant="ui.body" style={styles.onFeatureMuted}>
            Couldn't load your profile.
          </AppText>
        ) : (
          <>
            <View style={styles.profileTop}>
              <ProfileAvatarPicker
                name={profile.full_name || profile.email}
                seed={profile.id}
                avatarUrl={profile.avatar_url ?? null}
                size={AVATAR_SIZE}
                ringColor={colors.accent.gold}
              />
              <View style={styles.profileText}>
                <AppText variant="display.title" numberOfLines={2} style={styles.onFeature}>
                  {profile.full_name || displayEmail(profile.email)}
                </AppText>
                <AppText variant="ui.body" numberOfLines={1} style={styles.onFeatureMuted}>
                  {displayEmail(profile.email)}
                </AppText>
              </View>
            </View>
            <View style={styles.profileBottom}>
              <View style={styles.profileNotes}>
                {profileUpdated ? (
                  <AppText variant="ui.badge" style={styles.onFeatureMuted} accessibilityLiveRegion="polite">
                    Profile updated.
                  </AppText>
                ) : null}
                {publicName ? (
                  <AppText variant="ui.body" style={styles.onFeatureMuted}>
                    {`Shown as '${publicName}' on comments.`}
                  </AppText>
                ) : null}
              </View>
              <Pressable
                onPress={() => setDetailsSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <AppText variant="ui.label" style={styles.editText}>
                  Edit profile
                </AppText>
              </Pressable>
            </View>
          </>
        )}
      </View>

      <View style={styles.stats}>
        <Pressable
          onPress={() => router.push('/devotional/garden')}
          accessibilityRole="button"
          accessibilityLabel={`${keptWords} ${keptWords === 1 ? 'word' : 'words'} in your garden`}
          style={({ pressed }) => [styles.stat, styles.statGarden, pressed && styles.pressed]}
        >
          <AppText variant="display.title" style={styles.statGardenText}>
            {String(keptWords)}
          </AppText>
          <AppText variant="ui.badge" style={styles.statGardenText}>
            {keptWords === 1 ? 'word in your garden' : 'words in your garden'}
          </AppText>
        </Pressable>
        <Pressable
          onPress={() => router.push(pathnameFor(routeByKey('library')))}
          accessibilityRole="button"
          accessibilityLabel={`${playlistCount} ${playlistCount === 1 ? 'playlist' : 'playlists'}`}
          style={({ pressed }) => [styles.stat, styles.statPlaylists, pressed && styles.pressed]}
        >
          <AppText variant="display.title" style={styles.statPlaylistsText}>
            {String(playlistCount)}
          </AppText>
          <AppText variant="ui.badge" style={styles.statPlaylistsText}>
            {playlistCount === 1 ? 'playlist' : 'playlists'}
          </AppText>
        </Pressable>
      </View>

      <Group label="Appearance">
        <ThemeSwitch error={appearanceError} onError={setAppearanceError} />
      </Group>

      <Group label="Playback & downloads">
        <Panel>
          <ToggleRow
            label="Autoplay next in series"
            detail="Start the next part when one ends"
            value={preferences.autoplayNextInSeries}
            onValueChange={handleChangeAutoplay}
            disabled={isSaving}
            accessibilityLabel="Autoplay next in series"
          />
          <ToggleRow
            label="Download on Wi-Fi only"
            detail="Save mobile data"
            value={wifiOnly}
            onValueChange={(enabled) => {
              void setWifiOnly(enabled);
            }}
            disabled={isSavingWifiOnly}
            accessibilityLabel="Wi-Fi only downloads"
          />
          {/* The automatic play-cache only — downloads stay put. Hidden until there's
              something to clear. */}
          {playCache.bytes ? (
            <LinkRow
              icon="trash-outline"
              label={playCache.clearing ? 'Clearing…' : 'Clear cached sermons'}
              detail={`${formatCacheSize(playCache.bytes)} kept for faster replays. Downloads aren't affected.`}
              accessibilityLabel={`Clear cached sermons, ${formatCacheSize(playCache.bytes)}`}
              onPress={() => {
                if (!playCache.clearing) void playCache.clear();
              }}
            />
          ) : null}
        </Panel>
        {playbackError ? (
          <AppText variant="ui.badge" style={styles.errorText} accessibilityLiveRegion="polite">
            {playbackError}
          </AppText>
        ) : null}
      </Group>

      <Group label="Library">
        <Panel>
          <LinkRow
            icon="megaphone-outline"
            label="Announcements"
            onPress={() => router.push('/(tabs)/announcements')}
          />
          <LinkRow icon="ban-outline" label="Blocked users" onPress={() => router.push('/blocked-users')} />
        </Panel>
      </Group>

      <Group label="Help & safety">
        <Panel>
          <LinkRow
            icon="mail-outline"
            label="Contact us"
            detail={contactEmail}
            accessibilityLabel={`Contact us at ${contactEmail}`}
            onPress={() => {
              // A placeholder must never become a mailto: link.
              if (!contactPending) void Linking.openURL(`mailto:${contactEmail}`);
            }}
          />
        </Panel>
      </Group>

      <Group label="Legal">
        <Panel>
          {/* Hosted elsewhere (ADR 0017 D2); each link row exists only once its URL is set. */}
          {privacyPolicyUrl ? (
            <LinkRow
              icon="shield-checkmark-outline"
              label="Privacy policy"
              onPress={() => void Linking.openURL(privacyPolicyUrl)}
            />
          ) : null}
          {termsOfUseUrl ? (
            <LinkRow
              icon="document-text-outline"
              label="Terms of use"
              onPress={() => void Linking.openURL(termsOfUseUrl)}
            />
          ) : null}
          <LinkRow icon="chatbubble-outline" label="Community guidelines" onPress={() => setGuidelinesOpen(true)} />
        </Panel>
      </Group>

      {/* App Review 5.1.1(v): deletion is two taps from the Me tab. */}
      <Group label="Account">
        <Panel>
          <LinkRow
            icon="trash-outline"
            label="Delete account"
            detail="Permanently remove your account and data"
            onPress={() => router.push('/delete-account')}
          />
        </Panel>
      </Group>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void signOut()}
        style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
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
        avatarName={profile ? profile.full_name || profile.email : undefined}
        avatarSeed={profile?.id}
        avatarUrl={profile?.avatar_url ?? null}
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

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xxl + spacing.xs,
  },
  // Daybreak (canvas F1): the profile sits on the navy feature card in both themes.
  profileCard: {
    borderRadius: 26,
    overflow: 'hidden',
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.feature.bg,
    borderWidth: 1,
    borderColor: colors.feature.border,
  },
  profileOrb: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    right: -30,
    top: -40,
    backgroundColor: colors.feature.orb,
  },
  onFeature: {
    color: colors.feature.text,
  },
  onFeatureMuted: {
    color: colors.feature.muted,
  },
  editText: {
    color: colors.feature.eyebrow,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
  stat: {
    flex: 1,
    padding: spacing.md + 2,
    gap: 2,
    borderRadius: 20,
  },
  statGarden: {
    backgroundColor: colors.status.sage.bg,
  },
  statGardenText: {
    color: colors.status.sage.text,
  },
  statPlaylists: {
    backgroundColor: colors.status.slate.bg,
  },
  statPlaylistsText: {
    color: colors.status.slate.text,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  profileNotes: {
    flex: 1,
    gap: 2,
  },
  editButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.feature.muted,
  },
  group: {
    gap: spacing.sm + 2,
  },
  panel: {
    ...LEAF_SM,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  divided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  errorText: {
    color: colors.status.rose.text,
  },
  signOut: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.status.rose.border,
  },
  signOutText: {
    color: colors.status.rose.text,
  },
}));

import React from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppText, PrimaryButton } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useSermonDetail } from '../../lib/query/hooks/useSermons';
import { useSermonProgress } from '../../lib/query/hooks/useSermonProgress';
import { resolveCta } from './_detail/cta';
import { DetailError } from './_detail/ErrorState';
import { DetailHeader } from './_detail/Header';
import { isPlayable } from './_detail/isPlayable';
import { metaRow1, metaRow2 } from './_detail/meta';
import { DetailSkeleton } from './_detail/Skeleton';
import { TagsRow } from './_detail/TagsRow';

/**
 * Free sermon-detail screen (design spec §8, W4.0/W4.1). Binds only the fields §8.0 lists
 * from `GET /api/v1/catalog/sermons/{sermon_id}` (`SermonDetail`) — the public read, not
 * the staff-only `GET /api/v1/sermons/{sermon_id}` the original task brief named (§8.0's
 * own correction). Resume detection is the Conductor's decision (W4.1): call
 * `GET /sermons/{sermon_id}/progress` directly rather than the addendum's originally-bound
 * `/me/continue-watching` (bounded to the 10 most-recent plays) — see
 * `useSermonProgress.ts`'s docstring.
 */
export default function SermonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const detailQuery = useSermonDetail(id);
  const detail = detailQuery.data;
  const playable = detail ? isPlayable(detail) : false;
  // Only worth checking once we know the sermon is actually playable — a locked or
  // no-media sermon has no Fresh/Resume distinction to make (§8.3).
  const progressQuery = useSermonProgress(id, { enabled: Boolean(detail) && playable });

  const goBack = () => router.back();

  if (detailQuery.isLoading || (playable && progressQuery.isLoading)) {
    return (
      <View style={styles.screen}>
        <DetailHeader onBack={goBack} />
        <DetailSkeleton />
      </View>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <View style={styles.screen}>
        <DetailHeader onBack={goBack} />
        <DetailError onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  const eyebrow = [detail.category_name, detail.speaker_name].filter(Boolean).join(' · ');
  const row1 = metaRow1(detail, playable);
  // A progress-lookup failure degrades gracefully to "treat as Fresh" rather than
  // blocking the whole screen on a secondary, non-critical query.
  const row2 = metaRow2(detail, playable);
  const cta = resolveCta(detail, progressQuery.data ?? null);

  const onCtaPress = () => router.push({ pathname: '/player/[id]', params: { id: detail.id } });

  return (
    <View style={styles.screen}>
      <DetailHeader onBack={goBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {detail.thumbnail_url ? (
          <Image source={{ uri: detail.thumbnail_url }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={styles.heroFallback} />
        )}
        <View style={styles.body}>
          {eyebrow ? (
            <AppText variant="ui.label" tone="tertiary" style={styles.eyebrow}>
              {eyebrow}
            </AppText>
          ) : null}
          <AppText variant="display.compact">{detail.title}</AppText>
          <View style={styles.metaBlock}>
            <AppText variant="mono.meta" tone="tertiary">
              {row1}
            </AppText>
            {row2 ? (
              <AppText variant="mono.meta" tone="tertiary">
                {row2}
              </AppText>
            ) : null}
          </View>
          <View style={styles.ctaRow}>
            <PrimaryButton
              label={cta.label}
              accessibilityLabel={cta.accessibilityLabel}
              accessibilityHint={cta.caption ?? undefined}
              onPress={onCtaPress}
              disabled={cta.disabled}
            />
            {cta.secondaryReadout ? (
              <AppText variant="mono.meta" tone="tertiary">
                {cta.secondaryReadout}
              </AppText>
            ) : null}
          </View>
          {cta.caption ? (
            <AppText variant="ui.body" tone="tertiary">
              {cta.caption}
            </AppText>
          ) : null}
          {detail.description ? (
            <AppText variant="ui.body" tone="secondary">
              {detail.description}
            </AppText>
          ) : null}
          {detail.tags.length > 0 ? <TagsRow tags={detail.tags} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    paddingBottom: spacing.xxl * 2,
  },
  hero: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  heroFallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  eyebrow: {
    textTransform: 'uppercase',
  },
  metaBlock: {
    gap: spacing.xs,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
});

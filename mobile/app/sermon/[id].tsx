import React, { useState } from 'react';
import { Image, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { ActionButton, AppText, CastCloseHeader, DetailError, PrimaryButton, Tag } from '../../components';
import { DownloadPillButton } from '../../components/DownloadPillButton';
import { RelatedSermons } from '../../components/sermon/RelatedSermons';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { nextRelatedSermonRoute, RELATED_PARAM, RELATED_PARAM_VALUE } from '../../lib/navigation/detailTransition';
import { useSermonDetail } from '../../lib/query/hooks/useSermons';
import { useSermonProgress } from '../../lib/query/hooks/useSermonProgress';
import { resolveCta } from './_detail/cta';
import { isPlayable } from './_detail/isPlayable';
import { sermonMetaLine } from './_detail/meta';
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
  const { id, [RELATED_PARAM]: related } = useLocalSearchParams<{ id: string; [RELATED_PARAM]?: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [inMyList, setInMyList] = useState(false);
  const [liked, setLiked] = useState(false);

  const detailQuery = useSermonDetail(id);
  const detail = detailQuery.data;
  const playable = detail ? isPlayable(detail) : false;
  // Only worth checking once we know the sermon is actually playable — a locked or
  // no-media sermon has no Fresh/Resume distinction to make (§8.3).
  const progressQuery = useSermonProgress(id, { enabled: Boolean(detail) && playable });

  const goBack = () => router.back();
  // Close (the X) dismisses the whole stack — "close all pages" (Isaac's ask, session
  // 2026-10-01), however many Related/episode drill-down levels deep the user is —
  // rather than going back just one level the way the back chevron does.
  const onCloseAll = () => router.dismissAll();
  // Drill-down entry (Isaac's ask, session 2026-10-01): a Related item pushed this
  // screen on top of another detail screen, rather than presenting it fresh — see
  // `CastCloseHeader`'s own `onBack` prop doc, and `app/sermon/related/[id].tsx` for the
  // matching transition-animation half of this (a second route, not a per-push option).
  const onBack = related === RELATED_PARAM_VALUE ? goBack : undefined;

  // TanStack v5: isLoading is isPending && isFetching, and a disabled query never
  // fetches — so `progressQuery.isLoading` is `false`, not stuck `true`, once
  // `enabled` above goes false. That's why gating on it here can't hang the screen
  // for locked/no-media sermons that never enable the progress query at all.
  if (detailQuery.isLoading || (playable && progressQuery.isLoading)) {
    return (
      <View style={styles.screen}>
        <CastCloseHeader onClose={onCloseAll} onBack={onBack} />
        <DetailSkeleton />
      </View>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <View style={styles.screen}>
        <CastCloseHeader onClose={onCloseAll} onBack={onBack} />
        <DetailError onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  const metaLine = sermonMetaLine(detail);
  // A progress-lookup failure degrades gracefully to "treat as Fresh" rather than
  // blocking the whole screen on a secondary, non-critical query.
  const cta = resolveCta(detail, progressQuery.data ?? null);

  const onCtaPress = () => router.push({ pathname: '/player/[id]', params: { id: detail.id } });
  // Pushes a "Related" route (not this screen's own route) so the regular horizontal
  // push/back-gesture applies instead of the vertical-dismiss gesture. Alternates
  // between the two identically-configured Related routes based on the current
  // pathname (`nextRelatedSermonRoute`) — tapping Related again from within a Related
  // screen would otherwise push the exact same route name on top of itself, which
  // `react-native-screens` doesn't animate; see that function's own doc comment, and
  // `app/sermon/related/[id].tsx`'s. `related: '1'` still rides along so the screen
  // itself shows a back chevron alongside Cast/Close.
  const goToRelatedSermon = (sermonId: string) =>
    router.push({
      pathname: nextRelatedSermonRoute(pathname),
      params: { id: sermonId, [RELATED_PARAM]: RELATED_PARAM_VALUE },
    });
  const onShare = () => void Share.share({ message: detail.title });

  return (
    <View style={styles.screen}>
      <CastCloseHeader onClose={onCloseAll} onBack={onBack} />
      {/* Outside the ScrollView, in normal flow above it — not absolutely positioned
          behind scrolling content — so it never moves as the content below scrolls.
          Pull-to-dismiss (which does move the hero, along with everything else) is the
          Stack screen's own native vertical gesture (`app/_layout.tsx`'s
          `gestureDirection: 'vertical'`), not anything this screen drives itself. */}
      <View style={{ paddingTop: insets.top }}>
        {detail.thumbnail_url ? (
          <Image source={{ uri: detail.thumbnail_url }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={styles.heroFallback} />
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.body}>
          <AppText variant="display.compact">{detail.title}</AppText>
          <View style={styles.metaRow}>
            <AppText variant="mono.meta" tone="tertiary">
              {metaLine}
            </AppText>
            <Tag label={detail.tier === 'paid' ? 'Members' : 'Free'} />
          </View>
          <View style={styles.ctaSection}>
            <PrimaryButton
              label={cta.label}
              accessibilityLabel={cta.accessibilityLabel}
              accessibilityHint={cta.caption ?? undefined}
              icon="play"
              fullWidth
              onPress={onCtaPress}
              disabled={cta.disabled}
            />
            {playable ? <DownloadPillButton sermonId={detail.id} title={detail.title} /> : null}
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
          <View style={styles.actionRow}>
            <ActionButton
              icon={inMyList ? 'checkmark' : 'add'}
              label="My List"
              accessibilityLabel={inMyList ? 'Remove from My List' : 'Add to My List'}
              selected={inMyList}
              onPress={() => setInMyList((current) => !current)}
            />
            <ActionButton
              icon={liked ? 'heart' : 'heart-outline'}
              label="Like"
              accessibilityLabel={liked ? 'Unlike' : 'Like'}
              selected={liked}
              onPress={() => setLiked((current) => !current)}
            />
            <ActionButton icon="share-outline" label="Share" accessibilityLabel="Share this sermon" onPress={onShare} />
          </View>
        </View>

        <View style={styles.relatedSection}>
          <View style={styles.relatedHeaderWrap}>
            <AppText variant="ui.label" tone="primary" style={styles.relatedHeader}>
              related
            </AppText>
            <View style={styles.relatedHeaderUnderline} />
          </View>
          <RelatedSermons
            categoryId={detail.category_id}
            excludeSermonId={detail.id}
            excludeSeriesId={detail.series_id ?? undefined}
            onPressSermon={goToRelatedSermon}
            grid
          />
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
  // `overflow: 'hidden'` — without it Android doesn't reliably clip the Image's own
  // corners to `borderRadius`, so the cover-cropped art (already centered by
  // `resizeMode="cover"`'s own default) reads as spilling past the rounded edge instead
  // of a clean center crop (same fix series detail's own hero needed).
  hero: {
    aspectRatio: 16 / 9,
    marginHorizontal: spacing.xs,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  heroFallback: {
    aspectRatio: 16 / 9,
    marginHorizontal: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ctaSection: {
    gap: spacing.sm,
  },
  // Left-aligned with fixed gaps, not edge-to-edge `space-between` — matches Isaac's
  // own Netflix reference screenshot, session 2026-10-01. Gap widened past the token
  // scale's own max (`spacing.xxl`) per Isaac's own follow-up ask, same session.
  actionRow: {
    flexDirection: 'row',
    gap: spacing.xxl * 2,
  },
  relatedSection: {
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  relatedHeaderWrap: {
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
    gap: spacing.xs,
  },
  relatedHeader: {
    textTransform: 'uppercase',
  },
  // Bold text + gold underline strip (Isaac's ask, session 2026-10-01, matching
  // `DetailTabs`' own selected-tab treatment on series detail) — a static section
  // header here, not a toggleable tab, so the underline always shows.
  relatedHeaderUnderline: {
    height: 2,
    width: 56,
    backgroundColor: colors.accent.gold,
    borderRadius: 1,
  },
});

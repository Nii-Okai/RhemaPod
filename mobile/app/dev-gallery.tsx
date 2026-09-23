import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Card, LinkButton, PrimaryButton, ProgressBar, AppText } from '../components';
import { colors, radius, spacing, useAppFonts } from '../theme';
import type { DisplayVariant, MonoVariant, UiVariant } from '../theme/typography';

/**
 * Tokens/primitives gallery — a dev-only route (not part of the tab bar or any product
 * flow) that renders every design token and shared primitive from W3.1 so they can be
 * checked visually. Reachable at the "/dev-gallery" route.
 */
export default function DevGalleryScreen() {
  const { fontsLoaded, fontError } = useAppFonts();

  if (!fontsLoaded) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.accent.gold} />
        {fontError ? (
          <AppText variant="ui.body" tone="secondary" style={{ marginTop: spacing.md }}>
            Font load error: {fontError.message}
          </AppText>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section title="Surface ramp">
        <SwatchRow>
          <Swatch label="surface.app" color={colors.surface.app} />
          <Swatch label="surface.raised" color={colors.surface.raised} />
          <Swatch label="surface.nav" color={colors.surface.nav} />
          <Swatch label="surface.sunken" color={colors.surface.sunken} />
        </SwatchRow>
        <SwatchRow>
          <Swatch label="border.default" color={colors.border.default} />
          <Swatch label="border.card" color={colors.border.card} />
          <Swatch label="track.default" color={colors.track.default} />
        </SwatchRow>
        <SwatchRow>
          <Swatch label="chip.circle" color={colors.chip.circle} />
          <Swatch label="chip.square" color={colors.chip.square} />
        </SwatchRow>
      </Section>

      <Section title="Text hierarchy (on surface.raised)">
        <Card>
          <AppText variant="ui.body" tone="primary">
            text.primary — titles, primary body
          </AppText>
          <AppText variant="ui.body" tone="secondary" style={styles.stack}>
            text.secondary — descriptions, synopsis
          </AppText>
          <AppText variant="mono.meta" tone="tertiary" style={styles.stack}>
            text.tertiary — mono meta, eyebrow labels
          </AppText>
        </Card>
      </Section>

      <Section title="Gold accent (four distinct shades)">
        <SwatchRow>
          <Swatch label="accent.gold" color={colors.accent.gold} />
          <Swatch label="accent.goldText" color={colors.accent.goldText} />
          <Swatch label="accent.goldHover" color={colors.accent.goldHover} />
          <Swatch label="accent.goldHoverFilled" color={colors.accent.goldHoverFilled} />
        </SwatchRow>
      </Section>

      <Section title="Status pairs">
        <SwatchRow>
          <Swatch label="status.sage" color={colors.status.sage.bg} textColor={colors.status.sage.text} />
          <Swatch label="status.rose" color={colors.status.rose.bg} textColor={colors.status.rose.text} />
        </SwatchRow>
        <SwatchRow>
          <Swatch label="status.slate" color={colors.status.slate.bg} textColor={colors.status.slate.text} />
          <Swatch label="status.wheat" color={colors.status.wheat.bg} textColor={colors.status.wheat.dot} />
        </SwatchRow>
      </Section>

      <Section title="Spacing scale (4·8·12·16·20·24)">
        <SwatchRow>
          {(Object.keys(spacing) as (keyof typeof spacing)[]).map((token) => (
            <View key={token} style={styles.spacingItem}>
              <View style={[styles.spacingBox, { width: spacing[token], height: spacing[token] }]} />
              <AppText variant="mono.meta" tone="tertiary">
                {token} ({spacing[token]})
              </AppText>
            </View>
          ))}
        </SwatchRow>
      </Section>

      <Section title="Radius scale (6·9·12·16·pill)">
        <SwatchRow>
          {(Object.keys(radius) as (keyof typeof radius)[]).map((token) => (
            <View key={token} style={styles.spacingItem}>
              <View
                style={[
                  styles.radiusBox,
                  { borderRadius: token === 'pill' ? 24 : radius[token] },
                ]}
              />
              <AppText variant="mono.meta" tone="tertiary">
                {token}
              </AppText>
            </View>
          ))}
        </SwatchRow>
      </Section>

      <Section title="Typography — display (Newsreader, 400 only)">
        {(['hero', 'title', 'section', 'row', 'compact'] as DisplayVariant[]).map((variant) => (
          <AppText key={variant} variant={`display.${variant}`} style={styles.stack}>
            {variant} — The kingdom of heaven
          </AppText>
        ))}
      </Section>

      <Section title="Typography — UI (Figtree)">
        {(['bodyLarge', 'body', 'label', 'button', 'badge', 'avatarInitials'] as UiVariant[]).map((variant) => (
          <AppText key={variant} variant={`ui.${variant}`} style={styles.stack}>
            {variant} — Sign in to continue
          </AppText>
        ))}
      </Section>

      <Section title="Typography — mono (IBM Plex Mono, numeric/temporal only)">
        {(['meta', 'tight'] as MonoVariant[]).map((variant) => (
          <AppText key={variant} variant={`mono.${variant}`} tone="tertiary" style={styles.stack}>
            {variant} — 42:18 · Sep 4 · Ep. 05
          </AppText>
        ))}
      </Section>

      <Section title="Buttons">
        <PrimaryButton label="Sign in" onPress={() => {}} />
        <View style={styles.stack}>
          <PrimaryButton label="Loading" loading onPress={() => {}} />
        </View>
        <View style={styles.stack}>
          <PrimaryButton label="Disabled" disabled onPress={() => {}} />
        </View>
        <View style={styles.stack}>
          <LinkButton label="Forgot password?" onPress={() => {}} />
        </View>
      </Section>

      <Section title="Card">
        <Card>
          <AppText variant="display.compact">Storms of Life</AppText>
          <AppText variant="mono.meta" tone="tertiary" style={styles.stack}>
            Standalone · 31:02 · audio + video
          </AppText>
        </Card>
      </Section>

      <Section title="Avatar (rotating palette, two sizes)">
        <SwatchRow>
          <Avatar name="Ada Nwosu" size={40} />
          <Avatar name="John Mensah" size={40} />
          <Avatar name="Grace Owusu" size={38} />
          <Avatar name="T" size={38} />
        </SwatchRow>
      </Section>

      <Section title="Progress bar (scrub / download, shared component)">
        <ProgressBar progress={0.15} accessibilityLabel="15% downloaded" />
        <View style={styles.stack}>
          <ProgressBar progress={0.6} accessibilityLabel="12:04 of 42:18" />
        </View>
        <View style={styles.stack}>
          <ProgressBar progress={1} accessibilityLabel="100% downloaded" />
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="display.row" style={styles.sectionTitle}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

function SwatchRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.swatchRow}>{children}</View>;
}

function Swatch({ label, color, textColor }: { label: string; color: string; textColor?: string }) {
  return (
    <View style={styles.swatchItem}>
      <View style={[styles.swatchBox, { backgroundColor: color }]}>
        {textColor ? <View style={[styles.swatchDot, { backgroundColor: textColor }]} /> : null}
      </View>
      <AppText variant="mono.meta" tone="tertiary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  stack: {
    marginTop: spacing.sm,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  swatchItem: {
    width: 96,
    alignItems: 'center',
  },
  swatchBox: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    marginBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  spacingItem: {
    alignItems: 'center',
  },
  spacingBox: {
    backgroundColor: colors.accent.gold,
    marginBottom: spacing.xs,
  },
  radiusBox: {
    width: 48,
    height: 48,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    marginBottom: spacing.xs,
  },
});

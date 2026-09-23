import { PixelRatio } from 'react-native';

/**
 * Font family roles — strict separation per spec §1.2, a hard constraint from the brief,
 * not a suggestion:
 *  - Newsreader: display only (hero/section/card/list titles). Always weight 400 — no
 *    bold serif anywhere in the source.
 *  - Figtree: all UI text — body, labels, buttons, badges, avatar initials.
 *  - IBM Plex Mono: numeric/temporal data only (durations, dates, episode numbers, file
 *    sizes, timestamps). Always weight 400. Never carries a UI label; sans text never
 *    carries a number that reads as a duration/timestamp/episode index.
 *
 * Only load the weights actually used above — see theme/fonts.ts.
 */
export const fontFamily = {
  display: 'Newsreader_400Regular',
  ui: 'Figtree_400Regular',
  uiSemiBold: 'Figtree_600SemiBold',
  uiBold: 'Figtree_700Bold',
  mono: 'IBMPlexMono_400Regular',
} as const;

export type DisplayVariant = 'hero' | 'title' | 'section' | 'row' | 'compact';
export type UiVariant = 'bodyLarge' | 'body' | 'label' | 'button' | 'badge' | 'avatarInitials';
export type MonoVariant = 'meta' | 'tight';

interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  /** Multiplied against fontSize (and the live device font scale) — see scaledLineHeight. */
  lineHeightRatio: number;
}

/**
 * Display scale (Newsreader, 400 weight only). Sizes rationalized from spec §1.2's
 * observed ranges — target is within ±1-2px of source, not byte-exact.
 */
export const displayScale: Record<DisplayVariant, TypeStyle> = {
  hero: { fontFamily: fontFamily.display, fontSize: 32, lineHeightRatio: 1.08 },
  title: { fontFamily: fontFamily.display, fontSize: 26, lineHeightRatio: 1.1 },
  section: { fontFamily: fontFamily.display, fontSize: 24, lineHeightRatio: 1.15 },
  row: { fontFamily: fontFamily.display, fontSize: 20, lineHeightRatio: 1.1 },
  compact: { fontFamily: fontFamily.display, fontSize: 17, lineHeightRatio: 1.2 },
};

/** UI scale (Figtree). `label`/`button`/`badge`/`avatarInitials` carry weight via family. */
export const uiScale: Record<UiVariant, TypeStyle> = {
  bodyLarge: { fontFamily: fontFamily.ui, fontSize: 16, lineHeightRatio: 1.4 },
  body: { fontFamily: fontFamily.ui, fontSize: 14, lineHeightRatio: 1.4 },
  label: { fontFamily: fontFamily.uiSemiBold, fontSize: 13, lineHeightRatio: 1.2 },
  button: { fontFamily: fontFamily.uiSemiBold, fontSize: 14, lineHeightRatio: 1.2 },
  badge: { fontFamily: fontFamily.uiSemiBold, fontSize: 12, lineHeightRatio: 1.2 },
  avatarInitials: { fontFamily: fontFamily.uiBold, fontSize: 14, lineHeightRatio: 1 },
};

/** Mono scale (IBM Plex Mono, 400 weight only) — numeric/temporal data exclusively. */
export const monoScale: Record<MonoVariant, TypeStyle> = {
  meta: { fontFamily: fontFamily.mono, fontSize: 11, lineHeightRatio: 1.4 },
  tight: { fontFamily: fontFamily.mono, fontSize: 13, lineHeightRatio: 1 },
};

/**
 * Scalable font sizing (spec §6).
 *
 * React Native's `fontSize` is already the "scalable unit" here — there's no separate
 * sp/dp type to opt into like Android XML. `<Text>` multiplies fontSize by the OS text-
 * size setting automatically via `allowFontScaling`, which defaults to `true` and is
 * never overridden in this app's primitives. That's the whole mechanism: use plain
 * numeric fontSize tokens (never a fixed-size image/SVG for text), never set
 * `allowFontScaling={false}` or a low `maxFontSizeMultiplier`, and OS-level Dynamic
 * Type / Android font-scale settings apply automatically.
 *
 * The one thing that does NOT auto-scale is `lineHeight` — RN treats it as an absolute
 * number, so a hard-coded value would clip or overlap once fontSize grows under a large
 * accessibility setting. This helper derives lineHeight from the *current* device font
 * scale (`PixelRatio.getFontScale()`) so it grows in lockstep with fontSize.
 *
 * Known limitation: `PixelRatio.getFontScale()` is read at render time, not pushed via a
 * change event — RN has no public "font scale changed" listener. A screen already on
 * screen won't re-flow the instant the OS setting changes; it reflects the current value
 * on next mount/re-render (e.g. app foreground), which matches common RN practice.
 */
export function scaledLineHeight(fontSize: number, ratio: number): number {
  return Math.round(fontSize * ratio * PixelRatio.getFontScale());
}

export const typography = {
  fontFamily,
  displayScale,
  uiScale,
  monoScale,
  scaledLineHeight,
} as const;

import { PixelRatio } from 'react-native';

/**
 * Font family roles — strict separation per spec §1.2, a hard constraint from the brief,
 * not a suggestion. Daybreak redesign (2026-11) swapped the faces from
 * Newsreader/Figtree to Fraunces/Plus Jakarta Sans; the roles are unchanged.
 *  - Fraunces: display only (hero/section/card/list titles). Always weight 400 — no
 *    bold serif anywhere in the source.
 *  - Plus Jakarta Sans: all UI text — body, labels, buttons, badges, avatar initials.
 *  - IBM Plex Mono: numeric/temporal data only (durations, dates, episode numbers, file
 *    sizes, timestamps). Always weight 400. Never carries a UI label; sans text never
 *    carries a number that reads as a duration/timestamp/episode index.
 *
 * Only load the weights actually used above — see theme/fonts.ts.
 */
export const fontFamily = {
  display: 'Fraunces_400Regular',
  ui: 'PlusJakartaSans_400Regular',
  uiSemiBold: 'PlusJakartaSans_600SemiBold',
  uiBold: 'PlusJakartaSans_700Bold',
  mono: 'IBMPlexMono_400Regular',
} as const;

export type DisplayVariant = 'hero' | 'title' | 'section' | 'row' | 'compact' | 'scripture';
export type UiVariant =
  | 'bodyLarge'
  | 'body'
  | 'bodyBold'
  | 'label'
  | 'button'
  | 'badge'
  | 'avatarInitials'
  | 'actionLabel';
export type MonoVariant = 'meta' | 'tight' | 'counter';

interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  /** Multiplied against fontSize (and the live device font scale) — see scaledLineHeight. */
  lineHeightRatio: number;
}

/**
 * Display scale (Fraunces, 400 weight only). Sizes rationalized from spec §1.2's
 * observed ranges — target is within ±1-2px of source, not byte-exact.
 */
export const displayScale: Record<DisplayVariant, TypeStyle> = {
  hero: { fontFamily: fontFamily.display, fontSize: 32, lineHeightRatio: 1.08 },
  title: { fontFamily: fontFamily.display, fontSize: 26, lineHeightRatio: 1.1 },
  section: { fontFamily: fontFamily.display, fontSize: 24, lineHeightRatio: 1.15 },
  row: { fontFamily: fontFamily.display, fontSize: 20, lineHeightRatio: 1.1 },
  compact: { fontFamily: fontFamily.display, fontSize: 17, lineHeightRatio: 1.2 },
  /** A passage read slowly (Daily Rhema's Hear step). Open leading so Fraunces' tall
      ascenders never touch the line above. */
  scripture: { fontFamily: fontFamily.display, fontSize: 19, lineHeightRatio: 1.6 },
};

/** UI scale (Plus Jakarta Sans). `label`/`button`/`badge`/`avatarInitials` carry weight via family. */
export const uiScale: Record<UiVariant, TypeStyle> = {
  bodyLarge: { fontFamily: fontFamily.ui, fontSize: 16, lineHeightRatio: 1.4 },
  body: { fontFamily: fontFamily.ui, fontSize: 14, lineHeightRatio: 1.4 },
  /** Same metrics as `body`, bold weight — a bolded run inside otherwise-body text (e.g.
      a document's own title line rendered ahead of its body, TermsSheet's comment
      guidelines). Not a heading — use a `display.*` variant for that. */
  bodyBold: { fontFamily: fontFamily.uiBold, fontSize: 14, lineHeightRatio: 1.4 },
  label: { fontFamily: fontFamily.uiSemiBold, fontSize: 13, lineHeightRatio: 1.2 },
  button: { fontFamily: fontFamily.uiSemiBold, fontSize: 14, lineHeightRatio: 1.2 },
  badge: { fontFamily: fontFamily.uiSemiBold, fontSize: 12, lineHeightRatio: 1.2 },
  // Not `lineHeightRatio: 1` (exactly matching fontSize): a bold font's line box at `lineHeightRatio: 1` is
  // tighter than its natural ascent+descent, so the glyph renders visually shifted
  // within `Avatar`'s flex-centered circle rather than truly centered; every sibling
  // variant already uses 1.2+ for exactly this reason.
  avatarInitials: { fontFamily: fontFamily.uiBold, fontSize: 14, lineHeightRatio: 1.2 },
  /** Small bold label under an icon — `ActionButton`'s own label (My List/Like/Share/
      Download): smaller than `body`, bold rather than
      `label`'s semibold. */
  actionLabel: { fontFamily: fontFamily.uiBold, fontSize: 11, lineHeightRatio: 1.2 },
};

/** Mono scale (IBM Plex Mono, 400 weight only) — numeric/temporal data exclusively. */
export const monoScale: Record<MonoVariant, TypeStyle> = {
  meta: { fontFamily: fontFamily.mono, fontSize: 11, lineHeightRatio: 1.4 },
  tight: { fontFamily: fontFamily.mono, fontSize: 13, lineHeightRatio: 1 },
  /** Large ticking numbers — Signature Home's countdown to the next message. */
  counter: { fontFamily: fontFamily.mono, fontSize: 24, lineHeightRatio: 1.1 },
};

/**
 * Scalable font sizing (spec §6).
 *
 * React Native's `fontSize` is already the "scalable unit" here — there's no separate
 * sp/dp type to opt into like Android XML. `<Text>` multiplies fontSize by the OS text-
 * size setting automatically via `allowFontScaling`, which defaults to `true` and is
 * never overridden in this app's primitives. That's the whole mechanism: use plain
 * numeric fontSize tokens (never a fixed-size image/SVG for text), never set
 * `allowFontScaling={false}`, and OS-level Dynamic Type / Android font-scale settings
 * apply automatically.
 *
 * Text does stop growing at `MAX_FONT_SCALE` (below), which `AppText` passes as its
 * `maxFontSizeMultiplier`. iOS's largest accessibility sizes reach about 3.1x, where a
 * 32pt title becomes 100pt and fixed-width rows, pills and cards can't hold a word. The
 * caps still give UI text twice its size (the most Android offers at all) and display
 * text, already large, half again.
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
/** The most each type family grows with the OS text-size setting; see above. */
export const MAX_FONT_SCALE = {
  display: 1.5,
  ui: 2,
  mono: 2,
} as const;

export function scaledLineHeight(fontSize: number, ratio: number, maxScale: number = MAX_FONT_SCALE.ui): number {
  return Math.round(fontSize * ratio * Math.min(PixelRatio.getFontScale(), maxScale));
}

export const typography = {
  fontFamily,
  displayScale,
  uiScale,
  monoScale,
  scaledLineHeight,
  MAX_FONT_SCALE,
} as const;

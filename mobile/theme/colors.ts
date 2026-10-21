/**
 * Color design tokens — two palettes with one shape: `darkColors` (the original design)
 * and `lightColors` (the light-mode design review, Isaac's artifact 2026-10-21).
 *
 * Dark source: docs/design_mobile_app/mobile-design-spec.md §1.1 — values pulled from the
 * original design-canvas export's raw hex declarations, not approximated.
 *
 * Screens read the active palette with `useTheme()` / `createThemedStyles()`
 * (`theme/ThemeContext.tsx`). `colors` (bottom of this file) is the dark palette, kept
 * for surfaces that are dark in BOTH themes by design (the video player surface, art
 * overlays) and for modules not yet converted.
 *
 * This is the ONLY file in the app allowed to contain raw hex literals — see
 * theme/__tests__/no-raw-hex.test.ts, which enforces that everywhere else consumes
 * these tokens instead of hard-coding colors.
 */

/** Surface ramp (dark, navy-derived — darkest to lightest). */
export const surface = {
  app: '#0D111A',
  raised: '#131926',
  nav: '#182030',
  sunken: '#101520',
} as const;

export const border = {
  default: '#1C2434',
  card: '#24304A',
} as const;

export const track = {
  default: '#232C3E',
} as const;

/**
 * Icon/avatar chip backgrounds. Scoped to those components only — the spec is explicit
 * these are not general surfaces and shouldn't be promoted to the `surface` ramp.
 */
export const chip = {
  /** Circular icon/avatar chip bg, pairs with gold text. */
  circle: '#1F4276',
  /** Rounded-square icon chip bg (radius.md), same gold pairing. */
  square: '#1F2942',
} as const;

/** Text hierarchy — all pairings verified against real backgrounds at WCAG AA 4.5:1+. */
export const text = {
  primary: '#EEF1F6',
  secondary: '#A3AEC2',
  tertiary: '#7E8AA0',
} as const;

/**
 * Gold accent — the only interactive/brand accent. Four distinct shades, each with its
 * own role. Do not collapse these into a single "gold" value.
 */
export const accent = {
  /** Base gold fill — progress-bar fill, episode-number pill fill, wordmark accent. */
  gold: '#C99A33',
  /** Gold as text/icon color on dark surfaces (links, brand mark, icon-chip glyph). */
  goldText: '#E0B45C',
  /** Link hover state. */
  goldHover: '#F0C878',
  /** Filled-gold button hover state — no confirmed MVP surface yet, kept for parity. */
  goldHoverFilled: '#D9A947',
} as const;

/** Status pairs — bg + text (+ optional border/dot), each a distinct semantic status. */
export const status = {
  sage: { bg: '#1E3A2C', text: '#6FB08C' },
  rose: { bg: '#241620', border: '#5C3240', text: '#DD8A9B' },
  slate: { bg: '#1F3255', text: '#7FA0C4' },
  wheat: { bg: '#1A1610', border: '#5A4622', dot: '#E0B45C' },
} as const;

/**
 * Translucent chip surfaces for controls drawn over photographic art (hero eyebrow
 * badge, secondary circular button) — `surface.app` and `text.primary` at low alpha
 * rather than a solid fill, so they hold up over any thumbnail's color/brightness.
 */
export const overlay = {
  chipFill: 'rgba(13, 17, 26, 0.55)',
  chipBorder: 'rgba(238, 241, 246, 0.22)',
  /**
   * Bottom-of-art fade into the dark hero panel — `surface.app`'s rgb at rising, eased
   * alpha, stacked top-to-bottom as flat bands (no gradient dependency, same technique as
   * `fade` below). Dark in both themes: it sits on the art, not the chrome. Used by the
   * Signature Notifications latest-release card.
   */
  scrimLayers: [
    'rgba(13, 17, 26, 0)',
    'rgba(13, 17, 26, 0.15)',
    'rgba(13, 17, 26, 0.35)',
    'rgba(13, 17, 26, 0.6)',
    'rgba(13, 17, 26, 0.82)',
    'rgba(13, 17, 26, 0.95)',
  ],
} as const;

/**
 * Right-edge fade mask for a clipped single-line title (`FadeTitle`) — a "fade to the
 * card's own background" instead of an ellipsis. No gradient-library dependency — flat
 * bands of `surface.raised` (#131926 → rgb(19,25,38), the shelf cards' own bg) at
 * increasing alpha, stacked left-to-right, eased (not linear) so the bands don't read as
 * visible steps.
 */
export const fade = {
  layers: [
    'rgba(19, 25, 38, 0)',
    'rgba(19, 25, 38, 0.3)',
    'rgba(19, 25, 38, 0.65)',
    'rgba(19, 25, 38, 0.88)',
    'rgba(19, 25, 38, 1)',
  ],
} as const;

/**
 * Primary button surface — the only filled non-gold primary action (white pill). Note:
 * `primaryButton.text` and `surface.sunken` share the same hex (#101520) but are kept as
 * separate tokens on purpose — same value, two unrelated roles, per the spec's own
 * caution against conflating them.
 */
export const primaryButton = {
  bg: '#EEF1F6',
  text: '#101520',
} as const;

/**
 * Rotating background set for avatar-initials chips. The spec found no semantic
 * assignment logic in the source and recommends hashing a stable id into this 3-color
 * set (flagged as a product micro-decision, not a firm rule — see spec §5 item 6).
 */
export const avatarPalette = [status.slate.bg, status.sage.bg, chip.circle] as const;

/**
 * Drop shadow for a light surface raised over photographic art — `surface.app`'s own rgb
 * at opacity (not generic black), so it reads as "shadow into this screen's own
 * background" rather than an unrelated color. First use: onboarding's bottom card
 * (Isaac's ask, 2026-10-16: "the bottom parts looks too flat").
 */
export const shadow = {
  card: 'rgba(13, 17, 26, 0.45)',
} as const;

/** The original dark palette. */
export const darkColors = {
  surface,
  border,
  track,
  chip,
  text,
  accent,
  overlay,
  fade,
  status,
  primaryButton,
  avatarPalette,
  shadow,
} as const;

/** Same shape as the dark palette, with every leaf widened to `string`. */
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { readonly [K in keyof T]: Widen<T[K]> };
export type ColorTokens = Widen<typeof darkColors>;

/**
 * Light palette — from the light-mode design review. Every text/icon pairing re-verified
 * against WCAG AA (theme/__tests__/contrast.test.ts), not inverted by eye. Notes on the
 * values that are not a straight inversion:
 *
 * - surface: raised and nav are both pure white (nothing is lighter than white), so
 *   elevation comes from border + shadow; only `sunken` steps, and it steps DOWN.
 * - text.tertiary: #6E6858, one step darker than the review's #716B5A, which measured
 *   4.31:1 on `surface.sunken` (below AA). Now ≥4.5:1 on app, raised and sunken.
 * - accent: the gold ramp flips DIRECTION, not hue — `goldText` is the darkest shade on a
 *   light field and hover darkens further. `gold` is deepened so the progress fill clears
 *   3:1 on the light track.
 * - chip: warm gold-tinted washes rather than a pale blue inversion of the navy chips.
 * - overlay: unchanged — it sits on sermon art, whose brightness the theme doesn't change.
 * - fade: same alpha stops, base rgb swapped to the light card (`surface.raised`, white).
 * - primaryButton: fully flipped to a dark-ink pill. Where a primary pill sits ON art
 *   (the hero "Watch" pill, the onboarding card) it uses the dark palette's pill in both
 *   themes instead (Isaac's decision, 2026-10-21).
 * - shadow.card: a warm near-black at low opacity; a shadow in the surface's own (near
 *   white) colour wouldn't read as a shadow.
 */
const lightStatus = {
  sage: { bg: '#DCEEDF', text: '#2E6B47' },
  rose: { bg: '#F7DCE2', border: '#E7B9C6', text: '#A8324A' },
  slate: { bg: '#DDE8F5', text: '#2F5A8A' },
  wheat: { bg: '#F7EFD9', border: '#E6D7A6', dot: '#85600F' },
} as const;
const lightChip = { circle: '#F8ECC7', square: '#F2E7D2' } as const;

export const lightColors: ColorTokens = {
  surface: { app: '#F7F4EF', raised: '#FFFFFF', nav: '#FFFFFF', sunken: '#ECE7DD' },
  border: { default: '#E4DFD3', card: '#D8CFBE' },
  track: { default: '#F0EADD' },
  chip: lightChip,
  text: { primary: '#16140F', secondary: '#5B5648', tertiary: '#6E6858' },
  accent: { gold: '#A87A22', goldText: '#85600F', goldHover: '#6E4E0C', goldHoverFilled: '#966B12' },
  overlay,
  fade: {
    layers: [
      'rgba(255, 255, 255, 0)',
      'rgba(255, 255, 255, 0.3)',
      'rgba(255, 255, 255, 0.65)',
      'rgba(255, 255, 255, 0.88)',
      'rgba(255, 255, 255, 1)',
    ],
  },
  status: lightStatus,
  primaryButton: { bg: '#16140F', text: '#F7F4EF' },
  avatarPalette: [lightStatus.slate.bg, lightStatus.sage.bg, lightChip.circle],
  shadow: { card: 'rgba(22, 20, 15, 0.16)' },
};

export type ColorScheme = 'light' | 'dark';

export const palettes: Record<ColorScheme, ColorTokens> = {
  dark: darkColors,
  light: lightColors,
};

/**
 * The dark palette under its original name. Use it directly ONLY for surfaces that stay
 * dark in both themes by design (video player surface, controls over sermon art). Every
 * other screen should read the active palette from `useTheme()`.
 */
export const colors = darkColors;

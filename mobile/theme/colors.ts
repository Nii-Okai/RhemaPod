/**
 * Color design tokens.
 *
 * Source: docs/design_mobile_app/mobile-design-spec.md §1.1 — values pulled from the
 * original design-canvas export's raw hex declarations, not approximated.
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

export const colors = {
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
} as const;

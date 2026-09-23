/**
 * Spacing scale, rationalized from the design-canvas export's sub-pixel optical values
 * (spec §1.3) down to a clean scale. A few one-off hero/header paddings exist that are
 * safe-area dependent rather than a fixed token — those are handled at the call site,
 * not represented here.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export type SpacingToken = keyof typeof spacing;

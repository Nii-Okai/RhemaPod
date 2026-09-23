/**
 * Radius scale, rationalized from the design-canvas export's observed values
 * (4, 5, 6, 8, 9, 10, 11, 12, 14, 16, 20, 22, 999) down to five tokens (spec §1.3).
 * Note 20/22 round down to 16 — a deliberate, minor tightening, not a source-fidelity
 * claim.
 */
export const radius = {
  sm: 6,
  md: 9,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;

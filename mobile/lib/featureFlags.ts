/**
 * Rollout flags for the Signature redesign, built one screen at a time (Nii's plan,
 * 2026-10-21). Same mechanism as the light-mode flag (`theme/ThemeContext.tsx`): a public
 * Expo env var that Metro inlines at build time, so a build without it ships the current
 * screen unchanged. Remove each flag, and the screen it replaces, once that screen is
 * signed off.
 */

/** Signature Home (`app/(tabs)/_home/signature/`). Turn on with `EXPO_PUBLIC_SIGNATURE_HOME=1`. */
export const SIGNATURE_HOME_ENABLED = process.env.EXPO_PUBLIC_SIGNATURE_HOME === '1';

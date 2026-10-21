/**
 * Rollout flags for the Signature redesign, built one screen at a time (Nii's plan,
 * 2026-10-21). Same mechanism as the light-mode flag (`theme/ThemeContext.tsx`): a public
 * Expo env var that Metro inlines at build time, so a build without it ships the current
 * screen unchanged. Remove each flag, and the screen it replaces, once that screen is
 * signed off.
 */

/** Signature Home (`app/(tabs)/_home/signature/`). Turn on with `EXPO_PUBLIC_SIGNATURE_HOME=1`. */
export const SIGNATURE_HOME_ENABLED = process.env.EXPO_PUBLIC_SIGNATURE_HOME === '1';

/** Signature Notifications (`app/_notifications/`). Turn on with `EXPO_PUBLIC_SIGNATURE_NOTIFICATIONS=1`. */
export const SIGNATURE_NOTIFICATIONS_ENABLED = process.env.EXPO_PUBLIC_SIGNATURE_NOTIFICATIONS === '1';

/** Signature Browse (`app/(tabs)/_browse/signature/`). Turn on with `EXPO_PUBLIC_SIGNATURE_BROWSE=1`. */
export const SIGNATURE_BROWSE_ENABLED = process.env.EXPO_PUBLIC_SIGNATURE_BROWSE === '1';

/** Signature You page (`app/(tabs)/_me/signature/`). Turn on with `EXPO_PUBLIC_SIGNATURE_YOU=1`. */
export const SIGNATURE_YOU_ENABLED = process.env.EXPO_PUBLIC_SIGNATURE_YOU === '1';

/** Signature Player (`app/player/_signature/`). Turn on with `EXPO_PUBLIC_SIGNATURE_PLAYER=1`. */
export const SIGNATURE_PLAYER_ENABLED = process.env.EXPO_PUBLIC_SIGNATURE_PLAYER === '1';

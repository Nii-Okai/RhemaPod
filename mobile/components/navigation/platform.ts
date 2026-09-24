import { Platform } from 'react-native';

/**
 * Thin seam over `Platform.OS`, purely for testability: NavShell's chrome-swap tests
 * mock this one-line hook directly instead of reaching into React Native's internal
 * platform-specific module resolution (`Platform.ios.js`/`Platform.android.js`), which
 * is not something app code should ever depend on the shape of.
 */
export function usePlatformOS(): typeof Platform.OS {
  return Platform.OS;
}

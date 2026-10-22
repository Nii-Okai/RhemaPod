import { NativeModules } from 'react-native';

type GoogleCastModule = typeof import('react-native-google-cast');

/**
 * `react-native-google-cast`, or `null` when this build has no Cast SDK linked: Expo Go,
 * Jest, or a dev client installed before the library was added. The library builds its
 * native event emitters at import time and throws without the native module, so it is
 * only required once its native side is known to be there. A build-time constant, like
 * the rollout flags: every cast surface checks it once and picks its version.
 */
export const googleCast: GoogleCastModule | null = NativeModules.RNGCCastContext
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    (require('react-native-google-cast') as GoogleCastModule)
  : null;

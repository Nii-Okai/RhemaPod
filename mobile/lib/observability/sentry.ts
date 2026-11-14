/* global __DEV__ */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

/**
 * Crash and performance reporting.
 *
 * Off unless `EXPO_PUBLIC_SENTRY_DSN` is set at build time, so local dev, tests and
 * any build without the DSN send nothing. The DSN is not a secret (it only allows
 * sending events), which is why it can live in a public env var.
 *
 * What is sent: crashes, unhandled JS errors, errors caught by the root error
 * screen, and a sample of performance traces (app start, screen loads). What is not:
 * no request bodies, no default PII (IP, cookies), and no session replay.
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

let started = false;

export function initObservability(): void {
  if (started || !dsn) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? 'development' : 'production'),
    release: Constants.expoConfig?.version,
    enabled: !__DEV__,
    sendDefaultPii: false,
    // A fifth of sessions is plenty to see start-up and screen-load times without
    // spending the quota; raise it while chasing a specific slowdown.
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    integrations: [navigationIntegration],
  });
}

/** Tags events with the signed-in account's id (never email or name). */
export function setObservabilityUser(userId: string | null): void {
  if (!dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Reports an error that was caught and shown to the user (so it would not crash). */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!dsn) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export const wrapRoot = Sentry.wrap;

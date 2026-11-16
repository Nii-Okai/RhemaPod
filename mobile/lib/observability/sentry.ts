/* global __DEV__ */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { updateContext } from '../updates/otaUpdates';

/**
 * Crash and performance reporting.
 *
 * Off unless `EXPO_PUBLIC_SENTRY_DSN` is set at build time, so local dev, tests and
 * any build without the DSN send nothing. The DSN is not a secret (it only allows
 * sending events), which is why it can live in a public env var.
 *
 * What is sent: crashes, unhandled JS errors, errors caught by the root error
 * screen, and a sample of performance traces (app start, screen loads), tagged with
 * the account id only, and with which over-the-air update was running (update id,
 * channel, runtime version), so a crash can be traced to the fix that caused it.
 *
 * What is never sent (`scrubEvent` / `scrubBreadcrumb` below):
 * - default PII (IP address, cookies) and any user field but the id;
 * - request bodies and headers, and query strings on any URL, so the signed playback
 *   and download URLs and the auth tokens never leave the phone;
 * - console output as breadcrumbs (debug logging can contain anything);
 * - session replay, screenshots and view hierarchy (all off).
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

let started = false;

function stripQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.split(/[?#]/, 1)[0] : url;
}

/** Exported for tests. */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    event.request.url = stripQuery(event.request.url) as string | undefined;
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}

/** Exported for tests. */
export function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (crumb.category === 'console') return null;
  if (crumb.data && 'url' in crumb.data) crumb.data = { ...crumb.data, url: stripQuery(crumb.data.url) };
  if (crumb.data && 'to' in crumb.data) crumb.data = { ...crumb.data, to: stripQuery(crumb.data.to) };
  if (crumb.data && 'from' in crumb.data) crumb.data = { ...crumb.data, from: stripQuery(crumb.data.from) };
  return crumb;
}

export function initObservability(): void {
  if (started || !dsn) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? 'development' : 'production'),
    release: Constants.expoConfig?.version,
    enabled: !__DEV__,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    // A fifth of sessions is plenty to see start-up and screen-load times without
    // spending the quota; raise it while chasing a specific slowdown.
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    integrations: [navigationIntegration],
    initialScope: { tags: updateContext() },
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

/**
 * `EXPO_PUBLIC_API_BASE_URL` is the bare origin (`mobile/.env.example`, e.g.
 * `http://localhost:8000`) — every backend route lives under `/api/v1`, the
 * same prefix the admin portal's BFF targets (`admin_portal/lib/auth/upstream.ts`).
 */
const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export const API_BASE_URL = `${RAW_BASE_URL.replace(/\/+$/, '')}/api/v1`;

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

const DEFAULT_SHARE_BASE_URL = 'https://open.rhemapod.com';

/**
 * Origin of the https share links (ADR 0021) — the static `open.rhemapod.com` site, not the
 * API. `EXPO_PUBLIC_SHARE_BASE_URL` overrides it (e.g. a staging host); the default is the
 * permanent production host, so no EAS profile needs to set it. A function (not just the
 * constant) because Expo inlines `process.env.EXPO_PUBLIC_*` at transform time, so the
 * override can only be unit-tested through its input.
 */
export function resolveShareBaseUrl(raw: string | undefined): string {
  return (raw || DEFAULT_SHARE_BASE_URL).replace(/\/+$/, '');
}

export const SHARE_BASE_URL = resolveShareBaseUrl(process.env.EXPO_PUBLIC_SHARE_BASE_URL);

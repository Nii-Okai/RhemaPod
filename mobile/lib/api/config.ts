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

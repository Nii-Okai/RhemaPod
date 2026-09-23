/**
 * Spike-only env access. Deliberately not the main app's `lib/api/config.ts`
 * seam (this project is isolated by design — nothing here merges), but the
 * same `/api/v1` prefix convention, so hitting the same locally-running dev
 * API "just works" without inventing a second contract.
 */

const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export const API_BASE_URL = `${RAW_BASE_URL.replace(/\/+$/, '')}/api/v1`;

/**
 * The W0.1 test sermon's id (not the Stream UID — the dispatch names the
 * Stream UID, `9a643f36f98569c72bcb995248a7bc85`, for reference/debugging
 * only; the endpoints below take the sermon's own UUID). Isaac fills this in
 * via `.env` from the W0.1 provisioning entry in status.md — there is no
 * safe default to fall back to, so every screen surfaces a clear error
 * instead of silently calling `/sermons/undefined/...`.
 */
export const TEST_SERMON_ID = process.env.EXPO_PUBLIC_TEST_SERMON_ID ?? '';

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

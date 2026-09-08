/**
 * BFF auth layer (plan §A.2, W4).
 *
 * Barrel for the side-effect-free pieces only. Route handlers import the
 * server modules directly:
 *   - `./proxy`            — handleBffRequest (the `/api/bff/[...path]` route)
 *   - `./upstream`         — postUpstream / relayUpstreamError (the auth routes)
 *   - `./session`          — getServerUser (RSC bootstrap; pulls in next/headers)
 *   - `./session-context`  — SessionProvider / useSession ("use client")
 */

export {
  API_BASE_URL,
  PORTAL_ORIGIN,
  IS_PROD,
  BACKEND_API_PREFIX,
} from "./config";
export {
  AT_COOKIE,
  RT_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  ACCESS_MAX_AGE_FALLBACK_SECONDS,
  readAuthCookies,
  setAuthCookies,
  clearAuthCookies,
} from "./cookies";
export { csrfGuard, isSameOrigin, isMutating } from "./csrf";
export { decodeJwtExp, decodeJwtClaims, isExpiringSoon } from "./jwt";
export {
  refreshTokens,
  __resetRefreshDedupe,
  type RefreshResult,
  type RefreshOk,
  type RefreshFail,
} from "./exchange";
export type { SessionUser } from "./session-types";

/**
 * Minimal JWT payload reader (plan §A.2, step 3 of the proxy handler).
 *
 * The access token in `rp_at` is a backend-signed JWT that this app set itself.
 * The proxy only needs the `exp` claim to decide whether to refresh
 * preemptively — it does NOT need to verify the signature (FastAPI does that on
 * every call). So this is a deliberate unverified decode, not an oversight.
 */

export interface JwtClaims {
  exp?: number;
  [claim: string]: unknown;
}

/** Decode a JWT payload without verifying it. Returns `null` on any malformed
 *  input rather than throwing. */
export function decodeJwtClaims(token: string | undefined | null): JwtClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "=",
    );
    const json = Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(json) as unknown;
    if (!claims || typeof claims !== "object") return null;
    return claims as JwtClaims;
  } catch {
    return null;
  }
}

/** Read the `exp` claim (seconds since epoch), or `null` if absent/unparseable. */
export function decodeJwtExp(token: string | undefined | null): number | null {
  const claims = decodeJwtClaims(token);
  return typeof claims?.exp === "number" ? claims.exp : null;
}

/**
 * True when the token is missing, unreadable, already expired, or within
 * `skewSeconds` of expiry. Drives the preemptive refresh so the reactive
 * 401 path is the exception, not the norm (§A.2).
 */
export function isExpiringSoon(
  token: string | undefined | null,
  skewSeconds = 60,
): boolean {
  const exp = decodeJwtExp(token);
  if (exp === null) return true;
  return Date.now() / 1000 >= exp - skewSeconds;
}

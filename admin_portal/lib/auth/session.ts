/**
 * Server-side session bootstrap (plan §A.2 "Session bootstrap", §A.7).
 *
 * `(portal)/layout.tsx` calls this in a Server Component: read `rp_at`, call
 * `GET /api/v1/auth/me` server-to-server, hand `{id, email, name, role}` to a
 * client `SessionProvider`. No session round-trip on the client at first paint,
 * nothing in `localStorage`.
 *
 * On any failure (no cookie, 401, backend unreachable) it returns `null` and
 * the layout redirects to `/login`. Phase 1 does not attempt an RSC-side
 * refresh — a Server Component cannot rotate cookies, and calling the rotating
 * `/auth/refresh` here would burn the `jti` out from under the proxy. A user
 * returning after >15 min idle re-authenticates on the next hard navigation;
 * an active session stays warm because the proxy refreshes `rp_at` on data
 * calls. (Known Phase 1 rough edge — noted in status.md.)
 */

import { isApiError } from "@/lib/api/errors";
import { createServerApiClient } from "@/lib/api/server";

import type { SessionUser } from "./session-types";

export type { SessionUser } from "./session-types";

export async function getServerUser(): Promise<SessionUser | null> {
  let client;
  try {
    client = await createServerApiClient();
  } catch {
    return null;
  }

  try {
    const { data } = await client.GET("/api/v1/auth/me");
    if (!data) return null;
    return {
      id: String(data.id),
      email: data.email,
      name: data.full_name ?? null,
      role: String(data.role),
    };
  } catch (err) {
    // ApiError (401/404) → no session. Anything else (network, parse) → also
    // treat as no session and let the layout send the user to /login.
    void isApiError(err);
    return null;
  }
}

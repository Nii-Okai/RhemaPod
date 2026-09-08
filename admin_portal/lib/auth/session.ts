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
 *
 * Wrapped in React `cache()` so a cold `/` hit — which renders `app/page.tsx`
 * and `(portal)/layout.tsx`, both of which call this — makes one `/auth/me`
 * round-trip per request, not two.
 */

import { cache } from "react";

import { isApiError } from "@/lib/api/errors";
import { createServerApiClient } from "@/lib/api/server";
import { logError } from "@/lib/log";

import type { SessionUser } from "./session-types";

export type { SessionUser } from "./session-types";

async function loadServerUser(): Promise<SessionUser | null> {
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
    // 401 / 404 → no session, expected, quiet. Anything else (a 5xx, a network
    // failure, a parse error) is still "no session" for the user, but it is
    // worth a line so a backend outage is not invisible.
    const status = isApiError(err) ? err.status : null;
    if (status !== 401 && status !== 404) {
      logError("bff_session_bootstrap_failed", {
        status,
        correlationId: isApiError(err) ? err.correlationId : null,
      });
    }
    return null;
  }
}

export const getServerUser = cache(loadServerUser);

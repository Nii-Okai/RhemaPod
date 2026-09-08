/**
 * `requireRole` — page-level role gate for manager/admin-only screens
 * (plan §A.7 layer 4).
 *
 * Call it at the top of a Server Component page. Below the bar → `notFound()`,
 * NOT `redirect('/login')`: a redirect to login would tell an Editor the route
 * exists. 404 is the honest answer for "you may not see this".
 *
 * COSMETIC-ADJACENT: this stops an Editor rendering the page, but the FastAPI
 * `require_role` dependency is the real enforcement — every data call the page
 * would make is gated server-side regardless.
 *
 * `getServerUser()` is React-`cache()`d, so calling this in a page that also
 * renders under `(portal)/layout.tsx` costs no extra `/auth/me` round-trip.
 */

import { notFound } from "next/navigation";

import { getServerUser } from "./session";
import type { SessionUser } from "./session-types";

const RANK: Record<string, number> = {
  viewer: 0,
  editor: 1,
  manager: 2,
  admin: 3,
};

export async function requireRole(
  minimum: "manager" | "admin",
): Promise<SessionUser> {
  const user = await getServerUser();
  if (!user || (RANK[user.role] ?? -1) < RANK[minimum]) {
    notFound();
  }
  return user;
}

import { redirect } from "next/navigation";

import { getServerUser } from "@/lib/auth/session";

/**
 * Entry redirect. Phase 1 has no dashboard (Phase 2, §C), so a signed-in user
 * lands on the token reference until the Sermons list (W7) becomes home;
 * everyone else goes to `/login`.
 */
export default async function RootPage() {
  const user = await getServerUser();
  redirect(user ? "/tokens" : "/login");
}

import { redirect } from "next/navigation";

import { getServerUser } from "@/lib/auth/session";

/**
 * Entry redirect. Phase 1's home is the Sermons list (the Dashboard is Phase 2,
 * §C); W7 fills that route in, W5 ships a placeholder. Everyone else → `/login`.
 */
export default async function RootPage() {
  const user = await getServerUser();
  redirect(user ? "/sermons" : "/login");
}

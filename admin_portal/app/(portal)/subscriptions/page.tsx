import { requireRole } from "@/lib/auth/require-role";
import { SubscriptionsScreen } from "@/components/subscriptions/subscriptions-screen";

/**
 * Subscriptions (design Screen 9, plan W21).
 *
 * A thin Server Component: `requireRole` keeps the route 404 for Editors (the
 * Community nav group is hidden for them, and FastAPI's manager+ guard on
 * `/admin/subscriptions*` is the real enforcement regardless). Everything below
 * — the count tiles, the paying-members list, the status/tier filter, the
 * client-built CSV and the "Open in Stripe" deep link — is client React Query,
 * so this just mounts the screen.
 *
 * The screen is read-only: no route it calls mutates a subscription, and it
 * makes no outbound Stripe call (plan §A.3, decision 4).
 */
export default async function SubscriptionsPage() {
  await requireRole("manager");
  return <SubscriptionsScreen />;
}

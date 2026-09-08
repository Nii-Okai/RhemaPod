import { requireRole } from "@/lib/auth/require-role";
import { EmptyState, PageHeader } from "@/components/portal";

/**
 * Placeholder — the Review queue is W10. Manager/Admin only: `requireRole`
 * returns 404 for an Editor (plan §A.7 layer 4 — 404, not a login redirect, so
 * the route's existence isn't disclosed).
 */
export default async function ReviewPage() {
  await requireRole("manager");
  return (
    <>
      <PageHeader
        title="Review queue"
        subhead="Sermons editors have submitted, waiting on a manager."
      />
      <EmptyState
        title="Coming soon"
        description="The review queue and approval actions arrive in W10."
      />
    </>
  );
}

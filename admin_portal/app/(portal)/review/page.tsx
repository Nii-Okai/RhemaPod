import { requireRole } from "@/lib/auth/require-role";
import { ReviewScreen } from "@/components/review/review-screen";

/**
 * Review queue (design Screen 5, plan W10). Manager/Admin only: `requireRole`
 * returns 404 for an Editor (plan §A.7 layer 4 — 404, not a login redirect, so
 * the route's existence isn't disclosed). FastAPI's `ManagerPlus` guard on
 * `/approvals/sermons/*` is the real enforcement; this is the cosmetic layer.
 *
 * The header count line, the >48h alert and every transition are client-side
 * (React Query), so the screen itself is a Client Component.
 */
export default async function ReviewPage() {
  await requireRole("manager");
  return <ReviewScreen />;
}

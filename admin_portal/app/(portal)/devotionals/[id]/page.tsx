import { Suspense } from "react";

import { DevotionalEditor } from "@/components/devotionals/devotional-editor";

/**
 * Devotional create / edit (plan-daily-devotional A3). `id === "new"` is the
 * create flow (with an optional `?date=` from an empty calendar day).
 * The editor reads `useSearchParams`, so it sits under a Suspense boundary.
 */
export default async function DevotionalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="h-[600px] rounded-16 border border-border bg-surface" aria-busy />}>
      <DevotionalEditor devotionalId={id === "new" ? null : id} />
    </Suspense>
  );
}

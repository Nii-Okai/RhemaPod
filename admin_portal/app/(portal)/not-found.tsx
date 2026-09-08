import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/portal";

/**
 * Portal 404 — also what an Editor hits on a manager-only route (`requireRole`
 * calls `notFound()`, plan §A.7). Renders inside the shell, so the nav stays
 * usable. Deliberately says nothing about whether the route exists.
 */
export default function PortalNotFound() {
  return (
    <>
      <PageHeader
        title="Not found"
        subhead="That page isn't here, or isn't yours to see."
      />
      <EmptyState
        title="Nothing at this address"
        description="Check the link, or head back to your sermons."
        action={
          <Button asChild size="sm">
            <Link href="/sermons">Go to sermons</Link>
          </Button>
        }
      />
    </>
  );
}

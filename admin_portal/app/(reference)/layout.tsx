import type { ReactNode } from "react";

/**
 * `(reference)` — the W1 token audit (`/tokens`) and the W2 component gallery
 * (`/kit`). These are design-system references, not product screens: no shell,
 * no session bootstrap, no data. They stay reachable by direct URL for the
 * standing design-fidelity pass (plan risk D5) but are absent from the sidebar.
 *
 * Route groups don't touch the URL, so the pages keep `/tokens` and `/kit`.
 */
export default function ReferenceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="min-h-screen bg-canvas text-ink">{children}</div>;
}

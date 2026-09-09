import { SeriesScreen } from "@/components/series/series-screen";

/**
 * Series manager (design Screen 6, plan W11) — the card grid + create flow.
 *
 * A thin Server Component: the grid, per-card episode counts and every mutation
 * are client-rendered React Query (plan §A.4), so this just mounts the screen.
 */
export default function SeriesPage() {
  return <SeriesScreen />;
}

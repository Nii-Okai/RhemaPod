import { SeriesDetailScreen } from "@/components/series/series-detail-screen";

/**
 * Series create / edit (design Screen 6, plan W11 item 2).
 *
 * `id === "new"` is the create flow; any other id is the edit flow (form +
 * series art + episode order). A thin Server Component — the data load, the
 * not-found state and every mutation are client-side (plan §A.4).
 */
export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SeriesDetailScreen seriesId={id} />;
}

/**
 * Defensive, stable pinned-first re-sort (plan W4.4: "use the server's order
 * if it already does this; otherwise a stable client sort on the pinned
 * flag is fine"). `announcement_service.list_visible` already orders
 * pinned-first-then-newest server-side, so in practice this is a no-op —
 * kept as a belt-and-braces sort rather than trusting response order
 * blindly, since nothing about the `AnnouncementListItem` contract commits
 * to ordering. `Array.prototype.sort` is spec-stable in the JS engines this
 * app targets, but the explicit index tiebreaker makes that guarantee
 * visible in the code rather than implicit.
 */
export function sortPinnedFirst<T extends { pinned: boolean }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.pinned === b.item.pinned) return a.index - b.index;
      return a.item.pinned ? -1 : 1;
    })
    .map(({ item }) => item);
}

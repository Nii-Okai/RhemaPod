/**
 * Episode-order helpers for the Series manager (W11).
 *
 * The design's episode-order panel lets a manager reorder a series' episodes.
 * Batch 5 added `PUT /api/v1/series/{series_id}/episode-order` — one atomic
 * request that takes the full ordered episode-id list and renumbers the series
 * `1..N` by position in a single transaction. These helpers are pure so the
 * recompute is unit-tested without a DOM or the network:
 *
 *   - `sortEpisodes`    — display order for the panel rows.
 *   - `reorderEpisodes` — the new visual order after a single move, plus the
 *     locked-span refusal (a `pending_review` / `under_review` episode is an
 *     immovable fixed point; a move whose span would cross one is refused
 *     client-side before any request).
 *   - `seriesFooterLine` / `episodeNumberLabel` — small formatters.
 */

export interface OrderableEpisode {
  id: string;
  title: string;
  episode_number: number | null;
  status: string;
}

export interface ReorderResult<T extends OrderableEpisode> {
  /** The episodes in their new visual order, renumbered `1..N` by position —
      the exact shape the backend's atomic reorder persists. Used for the
      optimistic cache write and to derive the id list for the request. When the
      move is a no-op or was refused this is the input order, untouched. */
  order: T[];
  /** `true` when the move was refused because its span would cross or contain a
      locked (in-review) episode. `order` is the input untouched — the caller
      surfaces a note and issues no request. */
  refused: boolean;
}

/**
 * Sort episodes for display: `episode_number` ascending, `null` last, then by
 * title so the order is stable across renders and reloads.
 */
export function sortEpisodes<T extends OrderableEpisode>(episodes: readonly T[]): T[] {
  return [...episodes].sort((a, b) => {
    const an = a.episode_number;
    const bn = b.episode_number;
    if (an == null && bn == null) return a.title.localeCompare(b.title);
    if (an == null) return 1;
    if (bn == null) return -1;
    if (an !== bn) return an - bn;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Move the episode at `from` to `to` (indices into a list already in display
 * order) and renumber every row `1..N` by its new position — matching the
 * backend's atomic reorder, so the optimistic cache write and the eventual
 * server response agree.
 *
 * Locked (in-review) episodes are **immovable fixed points**. `lockedIds` is the
 * set of sermon ids whose review lock forbids an `episode_number` change. If the
 * span `[min(from,to), max(from,to)]` contains any locked row — including the
 * moved row itself — the whole move is refused: `{ order: input, refused: true
 * }`. A locked row *outside* the span whose number would still shift (a gapped
 * series renumbering to `1..N`) is caught by the backend's 409, not here.
 */
export function reorderEpisodes<T extends OrderableEpisode>(
  episodes: readonly T[],
  from: number,
  to: number,
  lockedIds?: ReadonlySet<string>,
): ReorderResult<T> {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= episodes.length ||
    to >= episodes.length
  ) {
    return { order: [...episodes], refused: false };
  }

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  if (lockedIds && lockedIds.size > 0) {
    for (let i = lo; i <= hi; i += 1) {
      if (lockedIds.has(episodes[i].id)) {
        return { order: [...episodes], refused: true };
      }
    }
  }

  const next = [...episodes];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return {
    order: next.map((ep, index) => ({ ...ep, episode_number: index + 1 })),
    refused: false,
  };
}

/**
 * The design's footer line on a series card: `"3 episodes · Teaching"`.
 *
 * `episode_count` is a required field on `SeriesPublic`, but a stale or partial
 * API response has been seen to omit it — which rendered the literal string
 * `"undefined episodes"`. Guard defensively: when the count is not a number,
 * drop the count segment entirely and show just the category. The category
 * itself is `string | null` on the DTO, so `null` falls back to
 * `"Uncategorized"`.
 */
export function seriesFooterLine(
  episodeCount: number | null | undefined,
  categoryName: string | null | undefined,
): string {
  const category = categoryName ?? "Uncategorized";
  if (typeof episodeCount !== "number") {
    return category;
  }
  const noun = episodeCount === 1 ? "episode" : "episodes";
  return `${episodeCount} ${noun} · ${category}`;
}

/** Two-digit mono episode number for the panel rows (`1` → `"01"`), em dash for
    an unnumbered episode. */
export function episodeNumberLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(n).padStart(2, "0");
}

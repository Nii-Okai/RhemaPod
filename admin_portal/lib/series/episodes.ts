/**
 * Episode-order helpers for the Series manager (W11).
 *
 * The design's episode-order panel lets a manager reorder a series' episodes by
 * rewriting each sermon's `episode_number`. There is **no bulk-reorder endpoint**
 * (flagged in `status.md` → [GATE 3 Batch 5]); a move is one `PATCH
 * /api/v1/sermons/{id}` per changed episode. These helpers are pure so the
 * recompute is unit-tested without a DOM or the network.
 *
 * Domain rule (`app/models/models.py`, design §"Backend contract"):
 * `episode_number` may have gaps and sorts ascending. So a move **keeps the set
 * of numbers already in use** and only reassigns which sermon holds which — a
 * drag never renumbers episodes it didn't pass, and gaps survive verbatim.
 */

export interface OrderableEpisode {
  id: string;
  title: string;
  episode_number: number | null;
  status: string;
}

/** A single `PATCH /api/v1/sermons/{id}` a reorder must issue. */
export interface EpisodePatch {
  id: string;
  title: string;
  episode_number: number;
}

export interface ReorderResult<T extends OrderableEpisode> {
  /** The episodes in their new visual order, with `episode_number` already
      updated on every row the move touched — for the optimistic cache write. */
  order: T[];
  /** One entry per episode whose `episode_number` actually changed. Empty when
      the move is a no-op *or* the move was refused (see `refused`). */
  patches: EpisodePatch[];
  /** `true` when the move was refused because its span would cross or contain a
      locked (in-review) episode. `order` is the input untouched, `patches` is
      empty — the caller should surface a note, not issue any PATCH. */
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
 * order) and recompute `episode_number`.
 *
 * Only the contiguous span between `from` and `to` is affected. The numbers
 * currently held by episodes in that span are collected, sorted ascending, and
 * handed back out in the span's new visual order — so a "move up one" swaps two
 * numbers, a longer drag rotates a block, and any gap between the span's
 * endpoints is preserved exactly. A `null` episode_number in the span is
 * replaced with a fresh number one past the highest in the whole series (the
 * backend auto-assigns on series attachment, so this is a defensive path).
 *
 * Locked (in-review) episodes are **immovable fixed points**. `lockedIds` is the
 * set of sermon ids whose review lock forbids an `episode_number` change. If the
 * span `[min(from,to), max(from,to)]` contains any locked row — including the
 * moved row itself — the whole move is refused: `{ order: input, patches: [],
 * refused: true }`. Shuffling numbers around fixed points is deliberately not
 * attempted (the backend has no status guard, so a stray PATCH behind a
 * disabled control would silently succeed); the caller shows a note instead.
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
    return { order: [...episodes], patches: [], refused: false };
  }

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  if (lockedIds && lockedIds.size > 0) {
    for (let i = lo; i <= hi; i += 1) {
      if (lockedIds.has(episodes[i].id)) {
        return { order: [...episodes], patches: [], refused: true };
      }
    }
  }

  const next = [...episodes];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  const globalMax = episodes.reduce(
    (max, ep) => (ep.episode_number != null && ep.episode_number > max ? ep.episode_number : max),
    0,
  );

  // Target numbers for the span: the concrete numbers it already holds, sorted
  // ascending, padded with fresh numbers for any nulls.
  const spanNumbers = episodes.slice(lo, hi + 1).map((ep) => ep.episode_number);
  const concrete = spanNumbers
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  let fresh = Math.max(globalMax, concrete[concrete.length - 1] ?? 0);
  while (concrete.length < spanNumbers.length) {
    fresh += 1;
    concrete.push(fresh);
  }

  const patches: EpisodePatch[] = [];
  const order = next.map((ep, index) => {
    if (index < lo || index > hi) return ep;
    const assigned = concrete[index - lo];
    if (ep.episode_number !== assigned) {
      patches.push({ id: ep.id, title: ep.title, episode_number: assigned });
    }
    return { ...ep, episode_number: assigned };
  });

  return { order, patches, refused: false };
}

/** The design's footer line on a series card: `"3 episodes · Teaching"`. */
export function seriesFooterLine(
  episodeCount: number,
  categoryName: string | null | undefined,
): string {
  const noun = episodeCount === 1 ? "episode" : "episodes";
  return `${episodeCount} ${noun} · ${categoryName ?? "Uncategorized"}`;
}

/** Two-digit mono episode number for the panel rows (`1` → `"01"`), em dash for
    an unnumbered episode. */
export function episodeNumberLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(n).padStart(2, "0");
}

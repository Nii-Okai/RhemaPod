export interface SermonMetaFields {
  series_title?: string | null;
  episode_number?: number | null;
  category_name?: string | null;
}

/** "Series Title · Episode N" for a series episode, the category alone for a standalone
 * sermon, or `null` for neither. Shared by `SermonAddRow` and `PlaylistItemRow`, which
 * show this line instead of speaker + duration. */
export function metaLineFor(sermon: SermonMetaFields): string | null {
  if (sermon.series_title) {
    return sermon.episode_number != null ? `${sermon.series_title} · Episode ${sermon.episode_number}` : sermon.series_title;
  }
  return sermon.category_name ?? null;
}

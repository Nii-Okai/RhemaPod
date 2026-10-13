import { spacing } from '../../../theme/spacing';

/** Shared sizing so a playlist row and a download row read as one consistent
 * list, not two components that happen to sit in the same screen (Isaac's
 * ask, session 2026-10-10: "Playlist and download list items should match
 * size in image"). `PlaylistCard`, `DownloadRow`, `PlaylistGridTile`, and
 * `DownloadGridTile` all size off these, rather than each picking its own
 * number. */
export const LIST_THUMBNAIL_SIZE = 64;

// 2, not 3 (Isaac's ask, session 2026-10-10: 3 columns left a visibly empty third
// column on real devices) — `GRID_PADDING` must match `library.tsx`'s own screen
// padding exactly (`spacing.xl`, not `spacing.lg`); a mismatch there was the actual
// bug: `tileWidth` came out a few px wider than the row actually had room for, so a
// 3rd tile often couldn't fit and wrapped to its own near-empty row instead of
// filling out the row above it.
export const GRID_COLUMNS = 2;
export const GRID_GAP = spacing.lg;
export const GRID_PADDING = spacing.xl;

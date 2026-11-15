import { spacing } from '../../../theme/spacing';

/** Shared sizing so a playlist row and a download row read as one consistent
 * list, not two components that happen to sit in the same screen. `PlaylistCard`, `DownloadRow`, `PlaylistGridTile`, and
 * `DownloadGridTile` all size off these, rather than each picking its own
 * number. */
export const LIST_THUMBNAIL_SIZE = 64;

// 2 columns. `GRID_PADDING` must match `library.tsx`'s own screen padding exactly
// (`spacing.xl`, not `spacing.lg`): on a mismatch `tileWidth` comes out a few px wider
// than the row has room for, and the last tile wraps to its own near-empty row.
export const GRID_COLUMNS = 2;
export const GRID_GAP = spacing.lg;
export const GRID_PADDING = spacing.xl;

/**
 * Formats a playlist's cumulative `total_duration_seconds` into the coarse
 * "N min" convention Spotify's own playlist header uses ("12 min", "0 min")
 * — distinct from `formatDuration` (a single sermon's `m:ss`/`h:mm:ss`
 * running time), which rounds to the second, not the minute, and renders
 * `--:--` rather than `0 min` for an unset/empty value.
 */
export function formatPlaylistMinutes(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0 min';
  }
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} min`;
}

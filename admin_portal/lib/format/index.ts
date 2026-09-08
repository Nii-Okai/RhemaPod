// Formatting helpers (plan §A.1). Filled as screens need them.
//
// W7 (Sermons list): `formatDuration` for the mono duration cell — `31:02`,
// `1:05:09`; an em dash is rendered by the caller when the value is null.

/**
 * Seconds → a clock string. Under an hour: `m:ss` (no leading zero on the
 * minutes, matching the design's `31:02`). An hour or more: `h:mm:ss`.
 * A non-finite or negative input returns an em dash.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (
    totalSeconds == null ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds < 0
  ) {
    return "—";
  }
  const whole = Math.round(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

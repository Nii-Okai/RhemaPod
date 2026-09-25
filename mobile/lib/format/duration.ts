/**
 * Formats a sermon's `duration_seconds` (nullable — a card can arrive before the media
 * pipeline has finished probing it) into the mono meta-line convention (spec §4: "compact
 * row ... mono meta line (duration, status)"): `m:ss` under an hour, `h:mm:ss` at/over one.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '--:--';
  }

  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

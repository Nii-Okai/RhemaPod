/**
 * Throughput-smoothed "N min remaining" estimate for an in-flight PUT
 * (plan §A.5 — "a rolling rate average over the last ~5 progress events gives
 * '3 min remaining' without it jittering").
 *
 * Pure. The uploader feeds it `(bytesSent, now)` on every `xhr.upload.onprogress`
 * tick; the row reads `remainingSeconds(total)` and renders `formatEta`.
 */

interface Sample {
  t: number;
  loaded: number;
}

/** Only samples newer than this (ms) count toward the rate — old, stale
 *  throughput from a slow start shouldn't drag the estimate. */
const WINDOW_MS = 5_000;

export class UploadRateEstimator {
  private samples: Sample[] = [];

  /** Record a progress observation. Non-monotonic or duplicate `loaded`
   *  values are tolerated (a retry can rewind); a non-increasing timestamp is
   *  ignored so the window math can never divide by zero. */
  sample(loaded: number, now: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && now <= last.t) return;
    this.samples.push({ t: now, loaded });
    const cutoff = now - WINDOW_MS;
    // Keep one sample older than the cutoff so a full window is always spanned.
    while (this.samples.length > 2 && this.samples[1].t < cutoff) {
      this.samples.shift();
    }
  }

  /** Bytes/second over the retained window, or `null` until there is enough
   *  signal (2 samples spanning real time and real progress). */
  bytesPerSecond(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    const db = last.loaded - first.loaded;
    if (dt <= 0 || db <= 0) return null;
    return db / dt;
  }

  /**
   * Seconds until `total` bytes are sent at the current smoothed rate, or
   * `null` when there is no usable rate yet or the transfer already looks
   * complete. Never negative, never `Infinity`/`NaN`. Derived purely from the
   * retained samples — the caller's wall clock is not needed.
   */
  remainingSeconds(total: number): number | null {
    const rate = this.bytesPerSecond();
    if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
    const last = this.samples[this.samples.length - 1];
    const sent = last ? last.loaded : 0;
    const left = total - sent;
    if (left <= 0) return 0;
    return left / rate;
  }

  reset(): void {
    this.samples = [];
  }
}

/**
 * Render an estimate as the design's trailing clause ("Uploading — 3 min
 * remaining"). `null` → a neutral "calculating…" so the row never shows a bare
 * dash mid-transfer.
 */
export function formatEta(remainingSeconds: number | null): string {
  if (remainingSeconds == null || !Number.isFinite(remainingSeconds)) {
    return "calculating…";
  }
  if (remainingSeconds < 45) return "less than a minute remaining";
  // Cap the top end — a post-burst trickle rate can otherwise produce
  // "about 417 hr remaining", which reads as broken.
  if (remainingSeconds >= 24 * 3600) return "more than a day remaining";
  const minutes = Math.round(remainingSeconds / 60);
  if (minutes < 60) return `about ${minutes} min remaining`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0
    ? `about ${hours} hr remaining`
    : `about ${hours} hr ${rem} min remaining`;
}

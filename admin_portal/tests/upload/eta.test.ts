import { describe, expect, it } from "vitest";

import { UploadRateEstimator, formatEta } from "@/lib/upload/eta";

/* W9 — the "N min remaining" estimator (plan §A.5: rolling rate over the last
   ~5s, must not divide by zero, handles 0 progress). Pure. */

describe("UploadRateEstimator", () => {
  it("returns null until there are two usable samples", () => {
    const e = new UploadRateEstimator();
    expect(e.remainingSeconds(1000)).toBeNull();
    e.sample(0, 0);
    expect(e.remainingSeconds(1000)).toBeNull();
  });

  it("never divides by zero on a non-advancing timestamp", () => {
    const e = new UploadRateEstimator();
    e.sample(0, 1000);
    e.sample(500, 1000); // same instant — ignored
    expect(e.bytesPerSecond()).toBeNull();
    expect(e.remainingSeconds(1000)).toBeNull();
  });

  it("returns null while progress is still zero", () => {
    const e = new UploadRateEstimator();
    e.sample(0, 0);
    e.sample(0, 1000);
    e.sample(0, 2000);
    expect(e.remainingSeconds(1000)).toBeNull();
  });

  it("estimates (remaining bytes / rate) at a steady rate", () => {
    const e = new UploadRateEstimator();
    // 1 MB/s over 3 seconds.
    e.sample(0, 0);
    e.sample(1_000_000, 1000);
    e.sample(2_000_000, 2000);
    e.sample(3_000_000, 3000);
    // 7 MB left at 1 MB/s ≈ 7s.
    expect(e.remainingSeconds(10_000_000)).toBeCloseTo(7, 0);
  });

  it("trends downward as the transfer proceeds at a constant rate", () => {
    const e = new UploadRateEstimator();
    const total = 10_000_000;
    e.sample(0, 0);
    e.sample(1_000_000, 1000);
    const early = e.remainingSeconds(total)!;
    e.sample(2_000_000, 2000);
    e.sample(3_000_000, 3000);
    const later = e.remainingSeconds(total)!;
    expect(later).toBeLessThan(early);
  });

  it("returns 0 once sent ≥ total", () => {
    const e = new UploadRateEstimator();
    e.sample(0, 0);
    e.sample(5_000_000, 1000);
    e.sample(10_000_000, 2000);
    expect(e.remainingSeconds(10_000_000)).toBe(0);
  });
});

describe("formatEta", () => {
  it("renders a neutral phrase for null", () => {
    expect(formatEta(null)).toBe("calculating…");
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe("calculating…");
  });

  it("collapses sub-45s to 'less than a minute'", () => {
    expect(formatEta(10)).toBe("less than a minute remaining");
    expect(formatEta(44)).toBe("less than a minute remaining");
  });

  it("rounds to whole minutes, then hours", () => {
    expect(formatEta(90)).toBe("about 2 min remaining");
    expect(formatEta(200)).toBe("about 3 min remaining");
    expect(formatEta(3600)).toBe("about 1 hr remaining");
    expect(formatEta(3600 + 20 * 60)).toBe("about 1 hr 20 min remaining");
  });

  it("caps the top end instead of quoting hundreds of hours", () => {
    expect(formatEta(24 * 3600)).toBe("more than a day remaining");
    expect(formatEta(417 * 3600)).toBe("more than a day remaining");
  });
});

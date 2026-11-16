/** Tunable media-cache constants in one place (plan D15, P1, P2). */

const GB = 1024 * 1024 * 1024;

/** Absolute upper bound on cache size (D15). */
export const HARD_CEILING_BYTES = 1 * GB;

/** Never fill when free space would drop below this (D15). */
export const FREE_SPACE_FLOOR_BYTES = 1.5 * GB;

/** Quota is this fraction of (free bytes + current cache bytes), capped by the ceiling (D15). */
export const QUOTA_FRACTION = 0.1;

/** Skip any single item larger than this fraction of the quota (D15). */
export const MAX_ITEM_QUOTA_FRACTION = 0.5;

/** P1: a leave qualifies for a fill only with progress inside this inclusive window (D3). */
export const FILL_PROGRESS_MIN = 0.05;
export const FILL_PROGRESS_MAX = 0.9;

/** P2: skip the fill if the /stream response is within this margin of expiring. */
export const STREAM_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

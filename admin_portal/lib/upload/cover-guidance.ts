/**
 * Guidance for sermon and series cover art.
 *
 * The mobile app shows covers whole in frames of different shapes (art that
 * doesn't match a frame sits centred over a blurred copy of itself), so one
 * square image serves every shelf. These helpers only advise: a cover that
 * isn't square or is small still uploads, with a warning beside it.
 */

export const COVER_HINT =
  "Square image, at least 1080 × 1080. Keep titles and faces inside the middle 80%.";

const MIN_SIDE = 800;
const SQUARE_TOLERANCE = 0.1; // 10% either way still counts as square

/** The advice for an image of `width` × `height`, or `null` when it's fine. */
export function coverDimensionsWarning(width: number, height: number): string | null {
  if (!(width > 0 && height > 0)) return null;
  const notes: string[] = [];
  const ratio = width / height;
  if (Math.abs(ratio - 1) > SQUARE_TOLERANCE) {
    notes.push(`it isn’t square (${width} × ${height}), so it shows with blurred edges in square frames`);
  }
  if (Math.min(width, height) < MIN_SIDE) {
    notes.push(`it’s small (${width} × ${height}) and may look soft on large phones`);
  }
  return notes.length ? `Uploaded, but ${notes.join(", and ")}.` : null;
}

/** Read an image file's pixel size in the browser; `null` if it can't be read. */
export async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

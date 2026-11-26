/**
 * How many pixels a capture's canvas may hold. A browser that will not make
 * a canvas that large says nothing: the canvas just comes back empty. Many
 * stop near 8192 × 8192, so after an empty canvas larger than that, captures
 * keep under it, unless one that large was drawn fine before (this browser
 * can, and the empty one failed for another reason).
 */

/** A canvas this large draws in the browsers in common use. */
export const SAFE_CANVAS_AREA = 8192 * 8192;

/** The canvas area captures may use, lowered once a large canvas came back empty. */
export interface CanvasArea {
  /** The most pixels a capture may draw now. */
  readonly limit: number;
  /** Notes a canvas of `pixels` that was drawn. */
  drawn(pixels: number): void;
  /**
   * Notes a canvas of `pixels` that came back empty. True when the limit
   * was lowered for it, so the same capture drawn smaller may work.
   */
  lowerFor(pixels: number): boolean;
  /** Puts the full limit back (a capture drawn under the lowered one failed too). */
  reset(): void;
}

/**
 * A canvas area starting at `full` pixels. `lowered` is where it goes after
 * a large empty canvas: under {@link SAFE_CANVAS_AREA} by a little more than
 * a capture's rounding can add.
 */
export function canvasArea(full: number, lowered: number): CanvasArea {
  let limit = full;
  let largest = 0;
  return {
    get limit() {
      return limit;
    },
    drawn(pixels) {
      largest = Math.max(largest, pixels);
      if (pixels > SAFE_CANVAS_AREA) limit = full;
    },
    lowerFor(pixels) {
      const worthIt = pixels > SAFE_CANVAS_AREA && limit > lowered && largest <= SAFE_CANVAS_AREA;
      if (worthIt) limit = lowered;
      return worthIt;
    },
    reset() {
      limit = full;
    },
  };
}

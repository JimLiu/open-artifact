/**
 * Keeping an export under the download limit: when a file comes out too
 * large at the picture quality asked for, the export runs again at a lower
 * step of its quality ladder. Pure, so the choice can be tested.
 */

/** One step of a quality ladder: how many pixels per slide (or shown) px pictures keep. */
export interface QualityStep {
  scale: number;
}

/** A pass that stopped early because its file would pass the limit. */
export class OverLimit extends Error {
  /** The whole file's estimated size, bytes. */
  readonly projected: number;
  /** The most the pass allowed, bytes (the same measure as `projected`). */
  readonly limit: number;

  constructor(projected: number, limit: number) {
    super('The file would be too large.');
    this.name = 'OverLimit';
    this.projected = projected;
    this.limit = limit;
  }
}

/**
 * The step to try after a file came out `size` bytes at step `from` of
 * `ladder` (sharpest first), with `limit` the most it may be: the sharpest
 * lower step whose estimate fits, else the lowest one. The estimate scales
 * the size by the ratio of the steps' scales to the power `exponent` (area
 * for pictures). `from` null is pictures kept as they are, with no scale to
 * compare: the next try is the sharpest step. Undefined when no step is lower.
 */
export function lowerStep(ladder: readonly QualityStep[], from: number | null, size: number, limit: number, exponent = 2): number | undefined {
  const start = from === null ? 0 : from + 1;
  if (start >= ladder.length) return undefined;
  if (from === null) return 0;
  const scale = ladder[from]!.scale;
  for (let i = start; i < ladder.length; i++) {
    if (size * (ladder[i]!.scale / scale) ** exponent <= limit) return i;
  }
  return ladder.length - 1;
}

/** True when `ladder` has a step below `from` (null: pictures as they are). */
export function hasLowerStep(ladder: readonly QualityStep[], from: number | null): boolean {
  return (from === null ? 0 : from + 1) < ladder.length;
}

/** One try at a file within a quality ladder. */
export interface StepTry {
  /** Index in the ladder; null keeps pictures as they are. */
  step: number | null;
  /** A lower step is left: passing the limit may stop with {@link OverLimit}. */
  canStepDown: boolean;
  /** The step is lower than the one asked for. */
  steppedDown: boolean;
}

/**
 * Makes a file with `make`, starting at step `start` of `ladder` and
 * stepping down while it stops with {@link OverLimit}; at the lowest step
 * it may not stop. `retry` runs before each new try (to drop what the given-up
 * try collected). Any other failure is passed on.
 */
export async function fitWithinLimit<T>(ladder: readonly QualityStep[], start: number | null, make: (attempt: StepTry) => Promise<T>, retry: () => void = () => {}): Promise<T> {
  let step = start;
  for (;;) {
    const canStepDown = hasLowerStep(ladder, step);
    try {
      return await make({ step, canStepDown, steppedDown: step !== start });
    } catch (error) {
      const next = canStepDown && error instanceof OverLimit ? lowerStep(ladder, step, error.projected, error.limit) : undefined;
      if (next === undefined) throw error;
      step = next;
      retry();
    }
  }
}

/** The whole file's size estimated from `bytes` written for `done` of `total` slides. */
export function projectedBytes(bytes: number, done: number, total: number): number {
  if (done <= 0 || total <= done) return bytes;
  return Math.ceil((bytes * total) / done);
}

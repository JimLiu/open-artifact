/**
 * Waiting out pictures a browser draws late.
 *
 * Some browsers draw an SVG `<foreignObject>` before the `data:` pictures in
 * it have decoded, so the first draw of a slide shows them blank. Drawing
 * the slide again, small, until it holds still gives them time to decode
 * before the real draw.
 */

/** Time between two redraws, ms. */
export const SETTLE_ROUND_MS = 50;
/** The longest a slide is redrawn waiting for its pictures, ms. */
export const SETTLE_LIMIT_MS = 2000;
/**
 * Redraws in a row that must read the same before the slide counts as
 * settled. One is not enough: two blank reads match while a picture is
 * still decoding.
 */
export const SETTLE_STILL_ROUNDS = 2;

/**
 * True when serialized slide markup holds a file inlined as a `data:` URL,
 * in an attribute or a CSS `url()`. Any type counts: an inlined file takes
 * the type its server gave, which may not say it is a picture.
 */
export function holdsInlinedPictures(markup: string): boolean {
  return /(?:="|url\((?:&quot;|["'])?)\s*data:/i.test(markup);
}

/** True when two reads of the same canvas hold the same pixels. */
export function samePixels(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** What decides whether a slide is redrawn before its real draw. */
export interface SettleCase {
  /** The browser draws foreignObject pictures before decoding them. */
  drawsLate: boolean;
  /** The slide holds `data:` pictures. */
  holdsPictures: boolean;
  /** Time left before the export must be done, ms; undefined when it has no deadline. */
  timeLeft?: number;
}

/** How long to spend redrawing a slide, ms; 0 to draw it straight away. */
export function settleBudget({ drawsLate, holdsPictures, timeLeft }: SettleCase): number {
  if (!drawsLate || !holdsPictures) return 0;
  if (timeLeft === undefined) return SETTLE_LIMIT_MS;
  return timeLeft > SETTLE_LIMIT_MS ? SETTLE_LIMIT_MS : 0;
}

/** The clock {@link drawUntilStill} runs on. */
export interface SettleClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/**
 * Calls `redraw` (which draws and reads back the pixels) once a round until
 * {@link SETTLE_STILL_ROUNDS} reads in a row match the one before, or until
 * `budget` ms have passed. Returns true when the picture held still.
 */
export async function drawUntilStill(redraw: () => ArrayLike<number>, budget: number, clock: SettleClock): Promise<boolean> {
  const stop = clock.now() + budget;
  let last: ArrayLike<number> | null = null;
  let still = 0;
  while (clock.now() < stop) {
    const read = redraw();
    still = last !== null && samePixels(last, read) ? still + 1 : 0;
    if (still >= SETTLE_STILL_ROUNDS) return true;
    last = read;
    await clock.sleep(SETTLE_ROUND_MS);
  }
  return false;
}

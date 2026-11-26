/**
 * Per-point pen widths of a stroke drawn with pressure.
 *
 * `widths` holds one base-36 digit per point: the factor the stroke's
 * `width` is multiplied by at that point. Digit `d` stands for `(d + 4) / 16`
 * (0.25–2.4375); `c` is 1, the plain width. A stroke whose every point is
 * `c` stores no `widths`.
 */

/** What a stored `widths` string may contain. */
export const STROKE_WIDTHS_PATTERN = /^[0-9a-z]+$/;

/** The digit of the plain width (factor 1). */
export const PLAIN_WIDTH_CODE = 'c';

/** The digit closest to a width factor. */
export function encodeWidthFactor(factor: number): string {
  const step = Math.round(factor * 16 - 4);
  return Math.min(35, Math.max(0, Number.isFinite(step) ? step : 12)).toString(36);
}

/** The width factor of one digit (1 for anything that is not a digit). */
export function decodeWidthCode(code: string): number {
  const digit = parseInt(code, 36);
  return Number.isNaN(digit) ? 1 : (digit + 4) / 16;
}

/** `widths` for a list of factors, or `undefined` when every point has the plain width. */
export function encodeStrokeWidths(factors: readonly number[]): string | undefined {
  let text = '';
  for (const factor of factors) text += encodeWidthFactor(factor);
  return text === '' || [...text].every((code) => code === PLAIN_WIDTH_CODE) ? undefined : text;
}

/** A stored `widths` value checked against a stroke of `pointCount` points, or `undefined` when it does not fit. */
export function normalizeStrokeWidths(value: unknown, pointCount: number): string | undefined {
  if (typeof value !== 'string' || value.length !== pointCount || !STROKE_WIDTHS_PATTERN.test(value)) return undefined;
  return value;
}

/** The width factors of a stroke (one per point), or `undefined` when it has none or they do not fit its points. */
export function strokeWidthFactors(stroke: { points: readonly number[]; widths?: string | undefined }): number[] | undefined {
  const widths = normalizeStrokeWidths(stroke.widths, stroke.points.length / 2);
  if (widths === undefined) return undefined;
  return Array.from(widths, decodeWidthCode);
}

/** The largest width factor of a stroke (1 without widths). */
export function strokeWidestFactor(stroke: { points: readonly number[]; widths?: string | undefined }): number {
  const factors = strokeWidthFactors(stroke);
  return factors === undefined ? 1 : Math.max(...factors);
}

/** The stroke with `widths` set to the given value, or without the field for `undefined`. */
export function withStrokeWidths<T extends { widths?: string }>(stroke: T, widths: string | undefined): T {
  const { widths: _widths, ...rest } = stroke;
  return (widths === undefined ? rest : { ...rest, widths }) as T;
}

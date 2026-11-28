/** A plain length in px (`12`, `12px`, `-3.5px`). */
const PLAIN_PX = /^\s*-?(\d+\.?\d*|\.\d+)(px)?\s*$/i;

/**
 * Where an element sits on one side (`left`, `top`, `right` or `bottom`), in px:
 * its inline value when that is plain px, or else the computed one. Read as a
 * number, `50%`, `2rem`, `calc(…)` or `auto` would make the first step of a
 * drag jump.
 */
export function placedPx(inline: string | undefined, computed: string | undefined): number {
  const number = parseFloat((inline && PLAIN_PX.test(inline) ? inline : computed) ?? '');
  return Number.isFinite(number) ? number : 0;
}

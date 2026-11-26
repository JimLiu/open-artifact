/**
 * Inline styles shared by the element views: rotation, text size and
 * weight, alignment and the hanging indent of lists. Colors come from the
 * core theme; layout rules live in `elements.css`.
 */

import type { CSSProperties } from 'react';
import {
  DEFAULT_TEXT_STYLE, HANG_CSS_VAR, TEXT_SIZE_STYLES, elementTurn, shapeFillPaint, shapeOutlineColor, shapeStrokePaint, shapeTextInsets, shapeTextLineCount,
  type BoardElement, type ColorScheme, type ShapeElement, type TextAlign, type TextSize,
} from '@open-artifact/whiteboard-core';

/** Inline style with CSS custom properties. */
export type ViewStyle = CSSProperties & { [variable: `--${string}`]: string | number | undefined };

/** The CSS rotation of an element (`rotate` plus `--wb-turn` for overlays); empty when unturned. */
export function rotationStyle(element: BoardElement): ViewStyle {
  const turn = elementTurn(element);
  return turn === 0 ? {} : { rotate: `${turn}deg`, '--wb-turn': `${turn}deg` };
}

/** The font of a note, shape or table: its size, or the default 15 px text. */
export interface PaperFont {
  px: number;
  weight: number;
  bold: number;
}

/** The font of text with an optional size (notes and shapes default to 15 px). */
export function paperFont(size: TextSize | undefined): PaperFont {
  if (size === undefined) return { px: DEFAULT_TEXT_STYLE.px, weight: DEFAULT_TEXT_STYLE.weight, bold: 700 };
  const style = TEXT_SIZE_STYLES[size];
  return { px: style.px, weight: style.weight, bold: style.bold };
}

/** Font size, weight and bold weight as inline style. */
export function fontStyle(font: PaperFont): ViewStyle {
  return { fontSize: font.px, fontWeight: font.weight, '--wb-bold': font.bold };
}

/** Text alignment as the variables `.wb-shape-label` and lists read. */
export function alignStyle(align: TextAlign): ViewStyle {
  return { '--wb-align': align, '--wb-justify': align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', textAlign: align };
}

/** The hanging indent of list text, in `ch` (`undefined` when there are no lists). */
export function hangStyle(hang: number | undefined): ViewStyle | undefined {
  return hang === undefined ? undefined : { [HANG_CSS_VAR]: `${Math.round(hang * 100) / 100}ch` };
}

/** Rounds a board coordinate for CSS (avoids long fractions in the DOM). */
export function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Width of the edge of an opened shape's text card, px. */
const TEXT_CARD_EDGE_PX = 2;
/** Room below the last line of an opened shape's text card, px. */
const TEXT_CARD_FOOT_PX = 8;

/**
 * How a shape's text area lays out its lines: `--wb-lines` caps how many it
 * shows. When the text does not fit (`cut`), it also places the card that
 * holds the whole text while the shape is open: it hangs from the top of
 * the text area as wide as the shape, reaches at least the shape's bottom
 * and grows below it, in the shape's fill and with its outline (or its edge
 * color when it has none). Offsets are from the text's own box, which then
 * spans the text area.
 */
export function shapeTextAreaStyle(element: ShapeElement, scheme: ColorScheme, cut: boolean): ViewStyle {
  const lines: ViewStyle = { '--wb-lines': shapeTextLineCount(element) };
  if (!cut) return lines;
  const { w, h } = element;
  const insets = shapeTextInsets(element.kind, w, h);
  const ink = shapeStrokePaint(element, scheme);
  const fill = shapeFillPaint(element);
  const half = TEXT_CARD_EDGE_PX / 2;
  return {
    ...lines,
    '--wb-card-left': `${px(-insets.left * w - half)}px`,
    '--wb-card-width': `${px(w + TEXT_CARD_EDGE_PX)}px`,
    '--wb-card-least': `${px(h * (1 - insets.top) + half)}px`,
    '--wb-card-foot': `${TEXT_CARD_FOOT_PX}px`,
    '--wb-card-edge': `${TEXT_CARD_EDGE_PX}px solid ${ink === 'none' ? shapeOutlineColor(element) : ink}`,
    ...(fill === 'none' ? {} : { '--wb-card-fill': fill }),
  };
}

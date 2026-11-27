/**
 * What the text style controls of a line of words offer and do, read once for the two places that show them: the
 * Text styles group under Layers, and the bar that floats over the words in full screen. The styles are asked of the
 * stage (`look`); a style every word of the line sets for itself (the stage's `own`) is offered by neither.
 */

import { useMemo } from 'react';
import type { ColorSwatch } from '@open-artifact/ui';
import {
  clampLoadedFontWeight,
  getLoadedFontCapabilities,
  getLoadedFontVariants,
  isEquivalentLoadedFontWeight,
  type RetouchProperty,
  type TextAlign,
} from '@open-artifact/motion-core';
import type { AskedLook, LayerRow, OwnTextStyle } from '@open-artifact/motion-stage/protocol';
import { useFilmSize } from '../player/StageView.tsx';
import { useFilm } from '../stores/film.ts';
import { countsIn, isSetByHand, useFilmSwatches, useRetouchState } from './AppearanceGroup.tsx';
import { opaqueHexColor, pickedColor } from './entry.ts';
import { commitLive, previewLayerProperties, setLayerProperties, shownValue, type LayerChange } from './retouch.ts';
import { useLayers, type AskedStyles } from './store.ts';
import { TYPE_STEPS, boldToggle, isClearInk, ownsStyle, roundTo, spacingSize, trackingPx, typeRange, type BoldToggle } from './type-style.ts';
import * as words from './words.ts';

export const TEXT_KEYS = ['weight', 'italic', 'px', 'leading', 'tracking', 'align', 'ink'] as const satisfies readonly RetouchProperty[];

/** Whether the stage gave anything of a line's style a person could change. */
export const hasEditableTextStyle = (look: AskedLook | null): boolean => look !== null && TEXT_KEYS.some((key) => look[key] !== null);

/** Whether the text styles will show the line's color, or its stand-in where the words set their own (so Appearance leaves it out). */
export const textStylesShowInk = (look: AskedLook | null): boolean => look !== null && ((look.ink !== null && !isClearInk(look.ink)) || ownsStyle(look, 'ink'));

/** A number control: what it shows, its range and step, and what a drag, a typed value and Reset do. */
export interface TypeNumberControl {
  value: number | null;
  min: number;
  max: number;
  step: number;
  live(value: number): void;
  /** null: the field was emptied. */
  commit(value: number | null): void;
  reset: (() => void) | null;
}

export interface TextStyleModel {
  row: LayerRow;
  look: AskedLook;
  owns(key: OwnTextStyle): boolean;
  /** Something of the line is set by hand: Reset all is offered. */
  anySet: boolean;
  /** Reset of the given styles, or null where none of them is set by hand. */
  reset(...properties: RetouchProperty[]): (() => void) | null;
  /** The weights the line's font has, lightest first. */
  weights: readonly number[];
  /** The weight on show (null: the stage gave none). */
  weight: number | null;
  setWeight(weight: number): void;
  bold: BoldToggle | null;
  /** Whether the line is italic (null: the stage gave no italics). */
  italic: boolean | null;
  setItalic(on: boolean): void;
  px: TypeNumberControl | null;
  leading: TypeNumberControl | null;
  tracking: TypeNumberControl | null;
  /** The line's color as an opaque hex (null: no color control). */
  ink: { value: string; live(picked: string): void; commit(picked: string): void; reset: (() => void) | null } | null;
  swatches: readonly ColorSwatch[];
  align: TextAlign | null;
  setAlign(align: TextAlign): void;
}

/** The text styles asked for a row: the stage's answer as it stands, and the model once there is something to offer. */
export interface TextStyles {
  styles: AskedStyles | null;
  model: TextStyleModel | null;
}

/** The text styles of a row, re-read as changes by hand are made, dragged or read again. */
export function useTextStyles(row: LayerRow): TextStyles {
  useRetouchState();
  const styles = useLayers((s) => (s.styles !== null && s.styles.id === row.id ? s.styles : null));
  const modules = useFilm((s) => s.film?.modules ?? null);
  const { height } = useFilmSize();
  const swatches = useFilmSwatches();
  const fonts = useMemo(() => getLoadedFontCapabilities(modules === null ? null : { modules, faces: null }), [modules]);
  const look = styles?.look ?? null;
  const weights = useMemo(() => (look === null ? [] : [...new Set(getLoadedFontVariants(look.family, fonts).map((variant) => variant.weight))].sort((a, b) => a - b)), [look, fonts]);
  if (look === null || (!hasEditableTextStyle(look) && (look.own?.length ?? 0) === 0) || look.kin === null) return { styles, model: null };

  const shown = (property: RetouchProperty) => shownValue(row, look, property, countsIn(look, property));
  const byHand = (property: RetouchProperty): boolean => isSetByHand(row, look, property);
  const change = (property: RetouchProperty, v: string | number | null): LayerChange => ({ row, look, property, v });
  const set = (changes: LayerChange[], what: string): void => void setLayerProperties(changes, words.undoLabel(what));
  const reset = (...properties: RetouchProperty[]): (() => void) | null =>
    properties.some(byHand) ? () => void setLayerProperties(properties.filter(byHand).map((property) => change(property, null)), words.UNDO_RESET) : null;

  // Weight, bold and italic.
  const weight = look.weight === null ? null : clampLoadedFontWeight(look.family, fonts, (shown('weight') as number | null) ?? look.weight);
  const filmWeight = look.weight === null ? null : clampLoadedFontWeight(look.family, fonts, look.weight);
  const setWeight = (to: number): void => {
    if (look.weight === null) return;
    const v = isEquivalentLoadedFontWeight(look.family, fonts, to, look.weight) ? look.weight : to;
    set([change('weight', v)], words.WEIGHT);
  };

  // Sizes. A number the control gives is kept as the record keeps it, held to its range.
  const number = (property: 'px' | 'leading' | 'tracking', what: string, value: number | null, range: ReturnType<typeof typeRange>, onEmpty: () => void): TypeNumberControl => ({
    value,
    min: range.min,
    max: range.max,
    step: TYPE_STEPS[property],
    live: (next) => previewLayerProperties([change(property, range.keep(next))], words.undoLabel(what)),
    commit: (next) => (next === null ? onEmpty() : set([change(property, range.keep(next))], what)),
    reset: reset(property),
  });
  const pxValue = look.px === null ? null : roundTo((shown('px') as number | null) ?? look.px, 10);
  const leadingShown = shown('leading');
  // Letter spacing counts by the line's size, which the stage still tells where the words set their own.
  const spacingPx = spacingSize(pxValue, look.linePx, look.px === null ? (shown('px') as number | null) : null);
  const trackingValue = look.tracking === null || spacingPx === null ? null : trackingPx((shown('tracking') as number | null) ?? look.tracking, spacingPx);

  // Color.
  const inkShown = opaqueHexColor(shown('ink') as string | null) ?? null;
  const inkValue = (picked: string): string | null => pickedColor(picked, look.ink, true);

  return {
    styles,
    model: {
      row,
      look,
      owns: (key) => ownsStyle(look, key),
      anySet: TEXT_KEYS.some(byHand),
      reset,
      weights,
      weight,
      setWeight,
      bold: boldToggle(weight, filmWeight, weights),
      italic: look.italic === null ? null : (shown('italic') as number | null) === 1,
      setItalic: (on) => set([change('italic', on ? 1 : 0)], words.ITALIC),
      px: pxValue === null ? null : number('px', words.FONT_SIZE, pxValue, typeRange('px', look.px, height), commitLive),
      leading:
        look.leading === null
          ? null
          : number('leading', words.LINE_HEIGHT, typeof leadingShown === 'number' ? roundTo(leadingShown, 100) : null, typeRange('leading', look.leading, height), () => {
              if (look.leading === 'normal') reset('leading')?.();
            }),
      tracking: trackingValue === null ? null : number('tracking', words.LETTER_SPACING, trackingValue, typeRange('tracking', look.tracking, height, spacingPx ?? 1), commitLive),
      ink:
        look.ink === null || isClearInk(look.ink) || inkShown === null
          ? null
          : {
              value: inkShown,
              live: (picked) => {
                const v = inkValue(picked);
                if (v !== null) previewLayerProperties([change('ink', v)], words.undoLabel(words.TEXT_COLOR));
              },
              commit: (picked) => {
                const v = inkValue(picked);
                if (v !== null) set([change('ink', v)], words.TEXT_COLOR);
              },
              reset: reset('ink'),
            },
      swatches,
      align: look.align === null ? null : ((shown('align') as TextAlign | null) ?? look.align),
      setAlign: (align) => set([change('align', align)], words.ALIGNMENT),
    },
  };
}

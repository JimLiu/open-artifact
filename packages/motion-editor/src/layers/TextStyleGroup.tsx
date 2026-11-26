/**
 * Text styles of the picked line of words: weight, bold and italic, font size, line height and letter spacing, color
 * and alignment, each with a Reset, and one Reset for all. The styles are asked of the stage (`look`), since the
 * reading of the layers does not carry them. The typeface (`face`) is not offered here. A style every word of the line
 * sets for itself (the stage's `own`) is shown as a disabled stand-in that says why, with its Reset off.
 */

import { useId, useMemo, type ReactElement, type ReactNode } from 'react';
import { Italic, RotateCcw, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart } from 'lucide-react';
import { IconButton, Row, Section, Segmented, SelectInput, Tooltip, cn } from '@open-artifact/ui';
import {
  TEXT_ALIGNS,
  clampLoadedFontWeight,
  getLoadedFontCapabilities,
  getLoadedFontVariants,
  isEquivalentLoadedFontWeight,
  type RetouchProperty,
  type TextAlign,
} from '@open-artifact/motion-core';
import type { AskedLook, LayerRow } from '@open-artifact/motion-stage/protocol';
import { useFilmSize } from '../player/StageView.tsx';
import { useFilm } from '../stores/film.ts';
import { ColorRow, NumberRow, ResetButton, countsIn, isSetByHand, onGroupKeyDown, useFilmSwatches, useRetouchState } from './AppearanceGroup.tsx';
import { opaqueHexColor, pickedColor } from './entry.ts';
import { commitLive, previewLayerProperties, setLayerProperties, shownValue, type LayerChange } from './retouch.ts';
import { useLayers } from './store.ts';
import { TYPE_STEPS, boldToggle, isClearInk, ownsStyle, roundTo, spacingSize, trackingPx, typeRange } from './type-style.ts';
import * as words from './words.ts';

const TEXT_KEYS = ['weight', 'italic', 'px', 'leading', 'tracking', 'align', 'ink'] as const satisfies readonly RetouchProperty[];

const ALIGN_ICONS: Readonly<Record<TextAlign, ReactElement>> = {
  left: <TextAlignStart className="size-3.5" />,
  center: <TextAlignCenter className="size-3.5" />,
  right: <TextAlignEnd className="size-3.5" />,
  justify: <TextAlignJustify className="size-3.5" />,
};

/** Whether the stage gave anything of a line's style a person could change. */
export const hasEditableTextStyle = (look: AskedLook | null): boolean => look !== null && TEXT_KEYS.some((key) => look[key] !== null);

/** Whether the text styles will show the line's color, or its stand-in where the words set their own (so Appearance leaves it out). */
export const textStylesShowInk = (look: AskedLook | null): boolean => look !== null && ((look.ink !== null && !isClearInk(look.ink)) || ownsStyle(look, 'ink'));

/** A field-like box for a stand-in: a dash, and a unit. */
function DashBox({ unit, className }: { unit?: string; className?: string }): ReactElement {
  return (
    <span className={cn('flex h-7 min-w-0 items-center justify-between rounded-control border border-line bg-surface-2 px-2 text-[13px] text-fg-subtle', className)}>
      {'\u2014'}
      {unit ? <span className="text-[11px]">{unit}</span> : null}
    </span>
  );
}

/** A row whose one style every word sets for itself: the stand-in, and a Reset that is off. */
function OwnStyleRow({ label, shortLabel, children }: { label: string; shortLabel?: string; children: ReactNode }): ReactElement {
  return (
    <Row label={shortLabel ?? label}>
      <OwnStyle labels={[label]}>{children}</OwnStyle>
      <ResetButton what={label} onReset={null} />
    </Row>
  );
}

/**
 * Controls drawn disabled where every word sets the style for itself. Screen readers get the controls' names and the
 * reason; the drawing is hidden from them. It takes the focus, so the reason shows from the keyboard too.
 */
function OwnStyle({ labels, children }: { labels: readonly string[]; children: ReactNode }): ReactElement {
  const id = useId();
  return (
    <Tooltip label={words.OWN_STYLE_REASON} side="left">
      <span role="group" tabIndex={0} aria-labelledby={id + '-names'} aria-describedby={id + '-why'} className="flex min-w-0 flex-1 rounded-control outline-none focus-visible:ring-1 focus-visible:ring-accent" data-own-style="">
        <span id={id + '-names'} className="sr-only">
          {labels.join(', ')}
        </span>
        <span id={id + '-why'} className="sr-only">
          {words.OWN_STYLE_REASON}
        </span>
        <span aria-hidden="true" className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 opacity-50">
          {children}
        </span>
      </span>
    </Tooltip>
  );
}

export function TextStyleGroup({ row }: { row: LayerRow }): ReactElement | null {
  useRetouchState();
  const styles = useLayers((s) => (s.styles !== null && s.styles.id === row.id ? s.styles : null));
  const modules = useFilm((s) => s.film?.modules ?? null);
  const { height } = useFilmSize();
  const swatches = useFilmSwatches();
  const fonts = useMemo(() => getLoadedFontCapabilities(modules === null ? null : { modules, faces: null }), [modules]);
  const look = styles?.look ?? null;
  const weights = useMemo(() => (look === null ? [] : [...new Set(getLoadedFontVariants(look.family, fonts).map((variant) => variant.weight))].sort((a, b) => a - b)), [look, fonts]);

  if (styles === null) return null;
  if (look === null)
    return (
      <Section title={words.TEXT_STYLES_TITLE}>
        <p className="px-1 text-xs text-fg-subtle" role="status">
          {styles.state === 'failed' ? words.COULD_NOT_READ_STYLES : words.READING_STYLES}
        </p>
      </Section>
    );
  if ((!hasEditableTextStyle(look) && (look.own?.length ?? 0) === 0) || look.kin === null) return null;
  const owns = (key: Parameters<typeof ownsStyle>[1]): boolean => ownsStyle(look, key);

  const shown = (property: RetouchProperty) => shownValue(row, look, property, countsIn(look, property));
  const byHand = (property: RetouchProperty): boolean => isSetByHand(row, look, property);
  const change = (property: RetouchProperty, v: string | number | null): LayerChange => ({ row, look, property, v });
  const set = (changes: LayerChange[], what: string): void => void setLayerProperties(changes, words.undoLabel(what));
  const reset = (...properties: RetouchProperty[]): (() => void) | null =>
    properties.some(byHand) ? () => void setLayerProperties(properties.filter(byHand).map((property) => change(property, null)), words.UNDO_RESET) : null;
  const anySet = TEXT_KEYS.some(byHand);

  // Weight, bold and italic.
  const shownWeight = look.weight === null ? null : clampLoadedFontWeight(look.family, fonts, (shown('weight') as number | null) ?? look.weight);
  const filmWeight = look.weight === null ? null : clampLoadedFontWeight(look.family, fonts, look.weight);
  const bold = boldToggle(shownWeight, filmWeight, weights);
  const italic = look.italic === null ? null : (shown('italic') as number | null) === 1;
  const setWeight = (weight: number): void => {
    if (look.weight === null) return;
    const v = isEquivalentLoadedFontWeight(look.family, fonts, weight, look.weight) ? look.weight : weight;
    set([change('weight', v)], words.WEIGHT);
  };
  const setItalic = (on: boolean): void => set([change('italic', on ? 1 : 0)], words.ITALIC);

  // Sizes.
  const px = look.px === null ? null : roundTo((shown('px') as number | null) ?? look.px, 10);
  const pxRange = typeRange('px', look.px, height);
  const leadingShown = shown('leading');
  const leading = typeof leadingShown === 'number' ? roundTo(leadingShown, 100) : null;
  const leadingRange = typeRange('leading', look.leading, height);
  // Letter spacing counts by the line's size, which the stage still tells where the words set their own.
  const spacingPx = spacingSize(px, look.linePx, look.px === null ? (shown('px') as number | null) : null);
  const tracking = look.tracking === null || spacingPx === null ? null : trackingPx((shown('tracking') as number | null) ?? look.tracking, spacingPx);
  const trackingRange = typeRange('tracking', look.tracking, height, spacingPx ?? 1);

  // Color.
  const inkShown = shown('ink') as string | null;
  const ink = look.ink === null || isClearInk(look.ink) ? null : (opaqueHexColor(inkShown) ?? null);
  const inkValue = (picked: string): string | null => pickedColor(picked, look.ink, true);

  const align = look.align === null ? null : ((shown('align') as TextAlign | null) ?? look.align);

  return (
    <div onKeyDown={onGroupKeyDown}>
      <Section
        title={words.TEXT_STYLES_TITLE}
        actions={
          <Tooltip label={anySet ? words.RESET_TEXT_STYLES : words.NOTHING_TO_RESET}>
            <IconButton
              size="sm"
              noTooltip
              label={words.RESET_TEXT_STYLES}
              icon={<RotateCcw className="size-3.5" />}
              disabled={!anySet}
              onClick={() => reset(...TEXT_KEYS)?.()}
            />
          </Tooltip>
        }
      >
        {shownWeight !== null || italic !== null || owns('weight') || owns('italic') ? (
          <Row label={shownWeight !== null || owns('weight') ? words.WEIGHT : words.EMPHASIS}>
            {owns('weight') ? (
              <OwnStyle labels={[words.WEIGHT, words.BOLD]}>
                <DashBox className="flex-1" />
                <span className="flex size-7 shrink-0 items-center justify-center text-[13px] font-bold text-fg-subtle">B</span>
              </OwnStyle>
            ) : shownWeight !== null && weights.length > 0 ? (
              <SelectInput
                aria-label={words.WEIGHT}
                className="min-w-0 flex-1"
                value={String(shownWeight)}
                options={weights.map((weight) => ({ value: String(weight), label: words.weightName(weight) }))}
                onChange={(value) => setWeight(Number(value))}
              />
            ) : (
              <span className="flex-1" />
            )}
            {bold !== null ? (
              <IconButton
                size="sm"
                label={words.BOLD}
                active={bold.pressed}
                icon={<span className={cn('text-[13px] leading-none', 'font-bold')}>B</span>}
                onClick={() => setWeight(bold.to)}
              />
            ) : null}
            {italic !== null ? (
              <IconButton size="sm" label={words.ITALIC} active={italic} icon={<Italic className="size-3.5" />} onClick={() => setItalic(!italic)} />
            ) : owns('italic') ? (
              <OwnStyle labels={[words.ITALIC]}>
                <span className="flex size-7 shrink-0 items-center justify-center text-fg-subtle">
                  <Italic className="size-3.5" />
                </span>
              </OwnStyle>
            ) : null}
            <ResetButton
              what={shownWeight !== null || owns('weight') ? words.WEIGHT : words.EMPHASIS}
              onReset={owns('weight') && italic === null ? null : reset('weight', 'italic')}
            />
          </Row>
        ) : null}
        {px !== null ? (
          <NumberRow
            label={words.FONT_SIZE}
            value={px}
            min={pxRange.min}
            max={pxRange.max}
            step={TYPE_STEPS.px}
            unit="px"
            onLive={(value) => previewLayerProperties([change('px', pxRange.keep(value))], words.undoLabel(words.FONT_SIZE))}
            onCommit={(value) => (value === null ? commitLive() : set([change('px', pxRange.keep(value))], words.FONT_SIZE))}
            onReset={reset('px')}
          />
        ) : owns('px') ? (
          <OwnStyleRow label={words.FONT_SIZE}>
            <DashBox unit="px" className="flex-1" />
          </OwnStyleRow>
        ) : null}
        {look.leading !== null ? (
          <NumberRow
            label={words.LINE_HEIGHT}
            slider={false}
            value={leading}
            min={leadingRange.min}
            max={leadingRange.max}
            step={TYPE_STEPS.leading}
            placeholder={words.AUTO}
            onLive={(value) => previewLayerProperties([change('leading', leadingRange.keep(value))], words.undoLabel(words.LINE_HEIGHT))}
            onCommit={(value) => {
              if (value === null) {
                if (look.leading === 'normal') reset('leading')?.();
                return;
              }
              set([change('leading', leadingRange.keep(value))], words.LINE_HEIGHT);
            }}
            onReset={reset('leading')}
          />
        ) : null}
        {tracking !== null ? (
          <NumberRow
            label={words.LETTER_SPACING}
            shortLabel={words.LETTER_SPACING_SHORT}
            slider={false}
            value={tracking}
            min={trackingRange.min}
            max={trackingRange.max}
            step={TYPE_STEPS.tracking}
            unit="px"
            onLive={(value) => previewLayerProperties([change('tracking', trackingRange.keep(value))], words.undoLabel(words.LETTER_SPACING))}
            onCommit={(value) => (value === null ? commitLive() : set([change('tracking', trackingRange.keep(value))], words.LETTER_SPACING))}
            onReset={reset('tracking')}
          />
        ) : owns('tracking') ? (
          <OwnStyleRow label={words.LETTER_SPACING} shortLabel={words.LETTER_SPACING_SHORT}>
            <DashBox unit="px" className="flex-1" />
          </OwnStyleRow>
        ) : null}
        {ink !== null ? (
          <ColorRow
            label={words.TEXT_COLOR}
            value={ink}
            swatches={swatches}
            onLive={(picked) => {
              const v = inkValue(picked);
              if (v !== null) previewLayerProperties([change('ink', v)], words.undoLabel(words.TEXT_COLOR));
            }}
            onCommit={(picked) => {
              const v = inkValue(picked);
              if (v !== null) set([change('ink', v)], words.TEXT_COLOR);
            }}
            onReset={reset('ink')}
          />
        ) : owns('ink') ? (
          <OwnStyleRow label={words.TEXT_COLOR}>
            <span className="size-5 shrink-0 rounded-sm border border-line bg-surface-2" />
            <DashBox className="flex-1" />
          </OwnStyleRow>
        ) : null}
        {align !== null ? (
          <Row label={words.ALIGNMENT}>
            <Segmented
              aria-label={words.ALIGNMENT}
              className="min-w-0 flex-1"
              value={align}
              options={TEXT_ALIGNS.map((value) => ({ value, label: ALIGN_ICONS[value], title: words.ALIGN_LABELS[value] }))}
              onChange={(value) => set([change('align', value)], words.ALIGNMENT)}
            />
            <ResetButton what={words.ALIGNMENT} onReset={reset('align')} />
          </Row>
        ) : null}
      </Section>
    </div>
  );
}

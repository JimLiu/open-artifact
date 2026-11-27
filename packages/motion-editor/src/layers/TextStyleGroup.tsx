/**
 * Text styles of the picked line of words: weight, bold and italic, font size, line height and letter spacing, color
 * and alignment, each with a Reset, and one Reset for all. The styles are asked of the stage (`look`), since the
 * reading of the layers does not carry them. The typeface (`face`) is not offered here. A style every word of the line
 * sets for itself (the stage's `own`) is shown as a disabled stand-in that says why, with its Reset off.
 */

import { useId, type ReactElement, type ReactNode } from 'react';
import { Italic, RotateCcw, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart } from 'lucide-react';
import { IconButton, Row, Section, Segmented, SelectInput, Tooltip, cn } from '@open-artifact/ui';
import { TEXT_ALIGNS, type TextAlign } from '@open-artifact/motion-core';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';
import { ColorRow, NumberRow, ResetButton, onGroupKeyDown } from './AppearanceGroup.tsx';
import { TEXT_KEYS, useTextStyles } from './text-style-model.ts';
import * as words from './words.ts';

export { hasEditableTextStyle, textStylesShowInk } from './text-style-model.ts';

export const ALIGN_ICONS: Readonly<Record<TextAlign, ReactElement>> = {
  left: <TextAlignStart className="size-3.5" />,
  center: <TextAlignCenter className="size-3.5" />,
  right: <TextAlignEnd className="size-3.5" />,
  justify: <TextAlignJustify className="size-3.5" />,
};

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
  const { styles, model } = useTextStyles(row);
  if (styles === null) return null;
  if (styles.look === null)
    return (
      <Section title={words.TEXT_STYLES_TITLE}>
        <p className="px-1 text-xs text-fg-subtle" role="status">
          {styles.state === 'failed' ? words.COULD_NOT_READ_STYLES : words.READING_STYLES}
        </p>
      </Section>
    );
  if (model === null) return null;
  const { owns, reset, anySet, weight: shownWeight, weights, setWeight, bold, italic, setItalic, px, leading, tracking, ink, swatches, align } = model;

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
          <NumberRow label={words.FONT_SIZE} value={px.value} min={px.min} max={px.max} step={px.step} unit="px" onLive={px.live} onCommit={px.commit} onReset={px.reset} />
        ) : owns('px') ? (
          <OwnStyleRow label={words.FONT_SIZE}>
            <DashBox unit="px" className="flex-1" />
          </OwnStyleRow>
        ) : null}
        {leading !== null ? (
          <NumberRow
            label={words.LINE_HEIGHT}
            slider={false}
            value={leading.value}
            min={leading.min}
            max={leading.max}
            step={leading.step}
            placeholder={words.AUTO}
            onLive={leading.live}
            onCommit={leading.commit}
            onReset={leading.reset}
          />
        ) : null}
        {tracking !== null ? (
          <NumberRow
            label={words.LETTER_SPACING}
            shortLabel={words.LETTER_SPACING_SHORT}
            slider={false}
            value={tracking.value}
            min={tracking.min}
            max={tracking.max}
            step={tracking.step}
            unit="px"
            onLive={tracking.live}
            onCommit={tracking.commit}
            onReset={tracking.reset}
          />
        ) : owns('tracking') ? (
          <OwnStyleRow label={words.LETTER_SPACING} shortLabel={words.LETTER_SPACING_SHORT}>
            <DashBox unit="px" className="flex-1" />
          </OwnStyleRow>
        ) : null}
        {ink !== null ? (
          <ColorRow
            label={words.TEXT_COLOR}
            value={ink.value}
            swatches={swatches}
            onLive={ink.live}
            onCommit={ink.commit}
            onReset={ink.reset}
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
              onChange={model.setAlign}
            />
            <ResetButton what={words.ALIGNMENT} onReset={reset('align')} />
          </Row>
        ) : null}
      </Section>
    </div>
  );
}

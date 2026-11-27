/**
 * The text styles of a line of words, on a bar that floats over the words: in full screen, where the Layers section
 * is not offered. Pressing a word on the picture (or its field under Text taking focus) opens it for the word's line.
 * The style chip (weight, size, line height, letter spacing), the color, Bold and Italic; the alignment; then Reset
 * and Close, which stay on the bar when the rest folds into More tools.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ALargeSmall, Bold, ChevronDown, Italic, MoveHorizontal, RotateCcw, UnfoldVertical, X } from 'lucide-react';
import { announce, isApplePlatform } from '@open-artifact/editor-kit';
import { ChromeButton, ChromeMenu, ChromeMenuItem, ChromePopover, FoldDivider, FoldGroup, FoldToolbar, TipButton, TipGroup, ToolButton, type FoldBand } from '@open-artifact/editor-kit/react';
import { ColorPicker, NumberInput, SelectInput, isComposingKey } from '@open-artifact/ui';
import { TEXT_ALIGNS, type TextBox } from '@open-artifact/motion-core';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';
import type { StageOverlayContext } from '../player/overlays.ts';
import { useComments } from '../comments/comments.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { useWorking } from '../stores/working.ts';
import { useEditableWords } from '../text/text-store.ts';
import { TWEAKS_PANEL } from '../tweaks/panel-id.ts';
import { pickLayer } from './reader.ts';
import { useLayers } from './store.ts';
import { stretchTakesRetouch } from './stretch.ts';
import { closeTextBar, useTextBar } from './text-bar.ts';
import { boldItalicKey, placeTextBar, styleChipLabel, textBarApplies, textRowForWord, wordEdges, type Edges, type TextBarPlace } from './text-bar-place.ts';
import { TEXT_KEYS, useTextStyles, type TextStyleModel } from './text-style-model.ts';
import { ALIGN_ICONS } from './TextStyleGroup.tsx';
import * as words from './words.ts';

/** Fields where typing is the field's own: Cmd+B and Cmd+I leave them alone, but for the words' own fields under Text. */
const OTHER_FIELD = 'input:not([type="range"]), textarea, select, [contenteditable="true"], [contenteditable=""]';
const WORD_FIELD = '[data-video-text]';
const OPEN_OVERLAY = '[role="dialog"], [role="alertdialog"]';

/** Whether the bar may show, as the stores have it now. */
function useTextBarApplies(): boolean {
  const fullscreen = useUi((s) => s.fullscreen);
  const tweaksOpen = useUi((s) => s.panel === TWEAKS_PANEL);
  const ready = useFilm((s) => s.stage === 'ready');
  const playing = usePlayback((s) => s.playing);
  const commenting = useComments((s) => s.on);
  const readOnly = useWorking((s) => s.readOnlyReason !== null);
  return textBarApplies({ fullscreen, tweaksOpen, ready, playing, commenting, readOnly });
}

const NO_BOXES: readonly TextBox[] = [];

/** The stage overlay: finds the line of the word the bar is for, picks its layer for its styles, and shows the bar. */
export function TextStyleBarOverlay({ box, scale }: StageOverlayContext): ReactElement | null {
  const on = useTextBarApplies();
  const id = useTextBar((s) => s.id);
  const { words: list } = useEditableWords();
  const boxes = (id === null ? undefined : list.find((word) => word.id === id)?.boxes) ?? NO_BOXES;
  const rows = useLayers((s) => s.report?.rows ?? null);
  const pickedId = useLayers((s) => s.pickedId);
  const stretch = useLayers((s) => s.stretch);
  const scenes = useFilm((s) => s.meta?.scenes ?? null);
  const row = useMemo(() => (on && id !== null ? textRowForWord(rows, boxes) : null), [on, id, rows, boxes]);

  useEffect(() => {
    if (row === null) return;
    if (useTextBar.getState().rowId !== row.id) useTextBar.setState({ rowId: row.id });
    if (pickedId !== row.id) pickLayer(row, 'keep');
  }, [row, pickedId]);

  const edges = useMemo(() => wordEdges(boxes, scale), [boxes, scale]);
  if (row === null || edges === null || pickedId !== row.id || stretch === null || !stretchTakesRetouch(stretch, scenes)) return null;
  return <TextStyleBar key={row.id} row={row} edges={edges} view={box} />;
}

/** The bar over one line's words. */
function TextStyleBar({ row, edges, view }: { row: LayerRow; edges: Edges; view: { width: number; height: number } }): ReactElement | null {
  const { model } = useTextStyles(row);
  const bar = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TextBarPlace | null>(null);
  const [band, setBand] = useState<FoldBand | undefined>(undefined);
  const latest = useRef(model);
  latest.current = model;

  // Placed once its size is known, and again as it or the picture changes size.
  useLayoutEffect(() => {
    const element = bar.current;
    if (element === null) return;
    const measure = (): void => {
      const next = placeTextBar(view, { width: element.offsetWidth, height: element.offsetHeight }, edges);
      setPlace((was) => (was !== null && (Object.keys(next) as (keyof TextBarPlace)[]).every((key) => was[key] === next[key]) ? was : next));
      // The More tools card opens inside the player, which cuts off what goes past it.
      const area = element.closest('[data-video-player-area]')?.getBoundingClientRect();
      setBand((was) => (area === undefined || (was?.top === area.top && was.bottom === area.bottom) ? was : { top: area.top, bottom: area.bottom }));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [model !== null, view.width, view.height, edges.left, edges.top, edges.right, edges.bottom]);

  // Cmd+B and Cmd+I toggle Bold and Italic while the bar shows.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = boldItalicKey(event, isApplePlatform());
      if (key === null || event.defaultPrevented || isComposingKey(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      if ((target?.matches(OTHER_FIELD) === true && target.closest(WORD_FIELD) === null) || document.querySelector(OPEN_OVERLAY) !== null) return;
      const now = latest.current;
      if (now === null) return;
      event.preventDefault();
      if (event.repeat) return;
      const toggle = key === 'b' ? boldPress(now) : italicPress(now);
      if (toggle !== null) toggle();
      else announce(key === 'b' ? boldNote(now) : italicNote(now));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  if (model === null) return null;
  const reset = model.reset(...TEXT_KEYS);
  const bold = boldPress(model);
  const italic = italicPress(model);
  const align = model.align;
  return (
    <TipGroup>
      <FoldToolbar
        ref={bar}
        aria-label={words.TEXT_STYLES_TITLE}
        data-video-text-bar=""
        className="absolute z-[8]"
        style={place === null ? { left: 0, top: 0, visibility: 'hidden' } : { left: place.left, top: place.top }}
        fold
        foldKey={row.id}
        placed={place?.placed ?? 'above'}
        limit={place?.most ?? Math.max(0, view.width - 16)}
        band={band}
      >
        <FoldGroup>
          {hasStyleFields(model) ? <StyleChip model={model} /> : null}
          {model.ink !== null ? (
            <ColorPicker
              aria-label={words.TEXT_COLOR}
              value={model.ink.value}
              alpha={false}
              swatches={model.swatches}
              side="top"
              onChange={model.ink.live}
              onCommit={model.ink.commit}
              trigger={
                <ChromeButton square aria-label={words.TEXT_COLOR} title={words.TEXT_COLOR}>
                  <span className="size-4 rounded-full border border-chrome-line" style={{ background: model.ink.value }} />
                </ChromeButton>
              }
            />
          ) : null}
          <TipButton square tip={boldNote(model)} aria-label={words.BOLD} pressed={bold === null ? undefined : model.bold?.pressed} disabled={bold === null} onClick={() => bold?.()}>
            <Bold className="size-4" />
          </TipButton>
          <TipButton square tip={italicNote(model)} aria-label={words.ITALIC} pressed={italic === null ? undefined : model.italic === true} disabled={italic === null} onClick={() => italic?.()}>
            <Italic className="size-4" />
          </TipButton>
        </FoldGroup>
        {align !== null ? (
          <>
            <FoldDivider />
            <FoldGroup>
              <ChromeMenu
                side="top"
                tip={{ label: words.alignedTo(words.ALIGN_LABELS[align]) }}
                trigger={
                  <ChromeButton square aria-label={words.alignedTo(words.ALIGN_LABELS[align])}>
                    {ALIGN_ICONS[align]}
                  </ChromeButton>
                }
              >
                {TEXT_ALIGNS.map((side) => (
                  <ChromeMenuItem key={side} checked={side === align} icon={ALIGN_ICONS[side]} onSelect={() => model.setAlign(side)}>
                    {words.ALIGN_LABELS[side]}
                  </ChromeMenuItem>
                ))}
              </ChromeMenu>
            </FoldGroup>
          </>
        ) : null}
        <FoldDivider />
        <FoldGroup tail>
          <TipButton square tip={reset === null ? words.NOTHING_TO_RESET : words.RESET_TEXT_STYLES} aria-label={words.RESET} data-video-text-bar-reset="" disabled={reset === null} onClick={() => reset?.()}>
            <RotateCcw className="size-4" />
          </TipButton>
          <ToolButton size="md" label={words.CLOSE} icon={<X />} onClick={() => closeTextBar(true)} />
        </FoldGroup>
      </FoldToolbar>
    </TipGroup>
  );
}

/** Whether the chip has fields to hold: weight, size, line height or letter spacing. */
const hasStyleFields = (model: TextStyleModel): boolean => weightOffered(model) || model.px !== null || model.leading !== null || model.tracking !== null;

const weightOffered = (model: TextStyleModel): boolean => model.weight !== null && model.weights.length > 0 && !model.owns('weight');

const boldPress = (model: TextStyleModel): (() => void) | null => {
  const bold = model.bold;
  return bold === null || model.owns('weight') ? null : () => model.setWeight(bold.to);
};

const italicPress = (model: TextStyleModel): (() => void) | null => {
  const italic = model.italic;
  return italic === null || model.owns('italic') ? null : () => model.setItalic(!italic);
};

/** What Bold says: its name, or why it is off. */
function boldNote(model: TextStyleModel): string {
  if (model.owns('weight')) return words.OWN_STYLE_REASON;
  if (model.weight === null) return words.WEIGHT_FIXED;
  if (model.bold !== null) return words.BOLD;
  return model.weights.length < 2 ? words.ONE_WEIGHT : words.NO_BOLD_WEIGHT;
}

function italicNote(model: TextStyleModel): string {
  if (model.owns('italic')) return words.OWN_STYLE_REASON;
  return model.italic === null ? words.ITALIC_FIXED : words.ITALIC;
}

/** The chip that shows the weight and size, and opens the fields that set them. */
function StyleChip({ model }: { model: TextStyleModel }): ReactElement {
  const weightText = weightOffered(model) && model.weight !== null ? (model.italic === true ? words.italicName(words.weightName(model.weight)) : words.weightName(model.weight)) : null;
  const label = styleChipLabel(weightText, model.px?.value ?? null, words.SPACING);
  return (
    <ChromePopover
      side="top"
      label={words.TEXT_STYLE}
      className="w-60 p-3"
      trigger={
        <ChromeButton aria-label={`${words.TEXT_STYLE}: ${label}`} title={words.TEXT_STYLE} className="max-w-48">
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-chrome-muted" />
        </ChromeButton>
      }
    >
      <div className="grid grid-cols-2 gap-2" data-video-text-bar-fields="">
        {weightOffered(model) && model.weight !== null ? (
          <SelectInput
            aria-label={words.WEIGHT}
            className="col-span-2"
            value={String(model.weight)}
            options={model.weights.map((weight) => ({ value: String(weight), label: words.weightName(weight) }))}
            onChange={(value) => model.setWeight(Number(value))}
          />
        ) : null}
        {model.px !== null ? (
          <NumberInput aria-label={words.FONT_SIZE} label={<ALargeSmall className="size-3.5" />} unit="px" value={model.px.value} min={model.px.min} max={model.px.max} step={model.px.step} onCommit={model.px.commit} />
        ) : null}
        {model.leading !== null ? (
          <NumberInput
            aria-label={words.LINE_HEIGHT}
            label={<UnfoldVertical className="size-3.5" />}
            placeholder={words.AUTO}
            value={model.leading.value}
            min={model.leading.min}
            max={model.leading.max}
            step={model.leading.step}
            onCommit={model.leading.commit}
          />
        ) : null}
        {model.tracking !== null ? (
          <NumberInput
            aria-label={words.LETTER_SPACING}
            label={<MoveHorizontal className="size-3.5" />}
            unit="px"
            value={model.tracking.value}
            min={model.tracking.min}
            max={model.tracking.max}
            step={model.tracking.step}
            onCommit={model.tracking.commit}
          />
        ) : null}
      </div>
    </ChromePopover>
  );
}

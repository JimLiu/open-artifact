/**
 * The right panel, after the Design inspector: a resizable side
 * sheet with Properties, Code and Tweaks tabs.
 *
 * - **Properties**: the layers list, then sections for what is selected —
 *   an element's Size, Layout, Text, Appearance and Effects; an artboard's
 *   frame; a note.
 * - **Code**: the layers list, then the element's own inline CSS and
 *   attributes as editable text, and what it inherits from its ancestors.
 * - **Tweaks**: the artboard's declared props as live controls.
 * - **Theme**: the design systems installed on the canvas (ThemePanel.tsx).
 *
 * Fields show the element's own inline value; the rendered value (from the
 * board runtime) is the placeholder, so an empty field means "inherited or
 * from a stylesheet".
 */

import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  Ban,
  Blend,
  ArrowDown,
  ArrowRight,
  Bold,
  Italic,
  Maximize2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Scan,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  attributeValue,
  elementKind,
  elementPath,
  hasDynamicStyle,
  parseDcDocument,
  parseStyle,
  resolveElement,
  serializeStyle,
  styleMap,
  tweakEntries,
  type ElementInspection,
  type HtmlElement,
  type PropSpec,
  type StylePatch,
  type TemplateModel,
} from '@open-artifact/dc';
import { cleanNoteCss, isLockedObject, noteCssValue, NOTE_COLORS, type BoardEntry, type CanvasNote, type NoteSize } from '@open-artifact/design-core';
import { LOCK_ATTRIBUTE, LOCKED_REASON } from '../lib/locks.ts';
import { useLockedWhy } from '../services/locks.ts';
import { GradientEditor, SliderInput, SwitchInput, cn, isComposingKey, toast, type SliderLook } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { boardApi } from '../services/frames.ts';
import { templateOf } from '../services/agent.ts';
import { alignMode, anyElementLocked, edit, mixedComputed, runAlign, styleMixed, styleSelection, updateBoard } from '../services/commands.ts';
import { rememberRadius } from '../services/radius-memory.ts';
import { hasCssBorder, NOTE_RECT_RADIUS, shapeFill } from '../lib/note-look.ts';
import { ALIGN_ACTIONS, alignShortcut, alignTip, type AlignAction } from '../lib/align.ts';
import { mixedElementKinds, mixedPaintValues, noteFillValues, paintMixed } from '../services/paint.ts';
import { changedBy, GUIDES_DIFFER, mixedRoles, MIXED_ACROSS, POSITION_ACROSS, positionBlocked, radiiAfter, radiusSaid, READ_SETTLE_MS, SIZED_BY_CONTENT, sharedGuides, sharedValue, typedChange } from '../lib/mixed-panel.ts';
import { announce } from '../services/announce.ts';
import { MIXED, inspectorRoute, mergedValue, selectionCounts, type MixedSelection, type ObjectsSelection, type PaintRole } from '../lib/selection.ts';
import { zoomToBoards } from '../services/viewport.ts';
import { isPathNote, NOTE_PALETTE, noteStroke } from '../lib/notes.ts';
import { noteRect } from '../lib/scene.ts';
import { describeElement, detailOf, selectorOf } from '../lib/outline.ts';
import { MOD } from '@open-artifact/editor-kit';
import { Tip } from '@open-artifact/editor-kit/react';
import { GuideInspector } from './LayoutGuides.tsx';
import { Outline } from './Outline.tsx';
import { isFontAvailable } from '../lib/fonts.ts';
import { matchSystemStyle, systemStylePatch, styleById, useDesignSystems, useSystemSwatches, useSystemTextStyles } from '../services/design-systems.ts';
import { ThemePanel } from './ThemePanel.tsx';
import { MediaSection } from './MediaSection.tsx';
import { BorderAlignButton } from './BorderAlign.tsx';
import { readAlignment, SIDES_NEED_INSIDE, type BorderLook } from '../lib/border-align.ts';
import { editSelectedAlignedBorder } from '../services/border-align.ts';
import { BORDER_STYLES as ELEMENT_BORDER_STYLES, borderColorOf, borderColorPatch, borderSidesPatch, borderStyleOf, borderStylePatch, borderWidthPatch, borderWidthsOf, WIDTHS_DIFFER, type BorderStyle } from '../lib/border-fields.ts';
import { COLUMNS_TIP, MAX_TRACKS, readSpan, ROWS_TIP, spanValue, trackCount, tracksShown, tracksValue } from '../lib/grid-tracks.ts';
import { clipsToText, fillColorPatch, isClearColor, removableFill } from '../lib/paint.ts';
import { FILL_IS_TEXT, firstStopOf, initialGradient, solidTextPatch, textGradientOf, textGradientPatch } from '../lib/text-gradient.ts';
import { loneShapeOf } from '../lib/lone-shape.ts';
import { removeFill } from '../services/paint.ts';
import { boardBackgrounds, PAGE_UNREADABLE, setBoardBackground } from '../services/properties.ts';
import {
  PButton,
  PColor,
  PIconButton,
  PInput,
  PNote,
  PRow,
  PSection,
  PSearchSelect,
  PSegments,
  type PSwatch,
  PSelect,
  PTipButton,
  isTransparent,
  roundPx,
  toHex,
  useDragResize,
  withoutUnit,
  type POption,
} from './fields.tsx';

import { isFixedPreset, nextPanelWidth, type PanelWidths } from '../lib/panel-width.ts';

/* --------------------------------- storage -------------------------------- */

function stored(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* storage may be unavailable */
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* --------------------------------- helpers -------------------------------- */

function updateNote(id: string, patch: Partial<CanvasNote>): void {
  useDocument.getState().updateCanvas((canvas) => {
    const note = canvas.notes[id];
    if (!note) return canvas;
    const next: CanvasNote = { ...note, ...patch };
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
    return { ...canvas, notes: { ...canvas.notes, [id]: next } };
  });
}

const num = (text: string) => Number.parseFloat(text);
const ICON = { className: 'size-4', strokeWidth: 1.5 } as const;

/** What every element section reads. */
export interface ElementContext {
  board: string;
  model: TemplateModel;
  element: HtmlElement;
  inline: Record<string, string>;
  computed: Record<string, string>;
  inspection: ElementInspection | null;
  locked: boolean;
  /**
   * Why the selection's size and position can't change (it is locked), or
   * `null`. Separate from `locked`: everything else stays editable.
   */
  lockedWhy: string | null;
  /** Writes to the selection; edits with the same `coalesce` key are one undo step (a slider drag). */
  set(patch: StylePatch, options?: { coalesce?: string }): void;
}

/* ---------------------------------- size ---------------------------------- */

type Sizing = 'hug' | 'fixed' | 'fill';
const SIZING: POption[] = [
  { value: 'hug', label: 'Hug' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'fill', label: 'Fill' },
];

function sizingOf(value: string | undefined): Sizing {
  if (!value || value === 'auto' || value === 'fit-content' || value === 'max-content') return 'hug';
  if (value === '100%' || value === 'stretch') return 'fill';
  return 'fixed';
}

function SizeRow({ ctx, axis }: { ctx: ElementContext; axis: 'width' | 'height' }) {
  const value = ctx.inline[axis];
  const mode = sizingOf(value);
  const rendered = Math.round(ctx.inspection?.rect[axis] ?? num(ctx.computed[axis] ?? '0'));
  return (
    <PRow label={axis === 'width' ? 'Width' : 'Height'}>
      <PInput
        aria-label={axis}
        value={mode === 'fixed' ? withoutUnit(value) : ''}
        placeholder={String(rendered)}
        unit="px"
        disabled={ctx.locked}
        onCommit={(next) => ctx.set({ [axis]: next || null })}
      />
      <PSelect
        aria-label={`${axis} sizing`}
        value={mode}
        options={SIZING}
        disabled={ctx.locked}
        className="w-[72px] shrink-0"
        onChange={(next) => ctx.set({ [axis]: next === 'hug' ? null : next === 'fill' ? '100%' : `${rendered}px` })}
      />
    </PRow>
  );
}

const SELF_ALIGN: Record<'align-self' | 'justify-self', { label: string; options: POption[] }> = {
  'align-self': {
    label: 'Align self',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'flex-start', label: 'Start' },
      { value: 'center', label: 'Center' },
      { value: 'flex-end', label: 'End' },
      { value: 'stretch', label: 'Stretch' },
    ],
  },
  'justify-self': {
    label: 'Justify self',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'start', label: 'Start' },
      { value: 'center', label: 'Center' },
      { value: 'end', label: 'End' },
      { value: 'stretch', label: 'Stretch' },
    ],
  },
};

const POSITIONS: POption[] = [
  { value: 'static', label: 'Inline' },
  { value: 'relative', label: 'Relative' },
  { value: 'absolute', label: 'Absolute' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'sticky', label: 'Sticky' },
];

function SizeSection({ ctx }: { ctx: ElementContext }) {
  const position = ctx.inline.position ?? ctx.computed.position ?? 'static';
  const parentFlex = (ctx.inspection?.parentDisplay ?? '').includes('flex');
  const parentGrid = (ctx.inspection?.parentDisplay ?? '').includes('grid');
  // A piece's element is placed by the piece itself.
  const piece = useDocument((s) => s.canvas.boards[ctx.board]?.frameless === true);
  return (
    <PSection title="Size">
      <SizeRow ctx={ctx} axis="width" />
      <SizeRow ctx={ctx} axis="height" />
      <PRow label="Position">
        <PSelect aria-label="Position" value={position} options={POSITIONS} disabled={ctx.locked || piece} onChange={(next) => ctx.set({ position: next === 'static' ? null : next })} />
      </PRow>
      {parentFlex ? (
        <PRow label="Grow">
          <PInput aria-label="Flex grow" name="Grow" min={0} numeric value={ctx.inline['flex-grow'] ?? ''} placeholder={ctx.computed['flex-grow'] ?? '0'} disabled={ctx.locked} onCommit={(next) => ctx.set({ 'flex-grow': next || null })} />
        </PRow>
      ) : null}
      {parentGrid ? (
        <PRow label="Span">
          {(['grid-column', 'grid-row'] as const).map((prop) => {
            const name = prop === 'grid-column' ? 'Column span' : 'Row span';
            const span = readSpan(ctx.inline[prop]).span;
            return (
              <Tip key={prop} label={name} side="top">
                <span className="min-w-0 flex-1">
                  <PInput aria-label={name} prefix={prop === 'grid-column' ? '↔' : '↕'} min={1} max={MAX_TRACKS} numeric value={span === null ? '' : String(span)} placeholder={readSpan(ctx.computed[prop]).span?.toString() ?? 'auto'} disabled={ctx.locked}
                    onCommit={(next) => ctx.set({ [prop]: spanValue(ctx.inline[prop], next) })} />
                </span>
              </Tip>
            );
          })}
        </PRow>
      ) : null}
      {(['min', 'max'] as const).map((bound) => (
        <PRow key={bound} label={bound === 'min' ? 'Min' : 'Max'}>
          {(['width', 'height'] as const).map((axis) => {
            const prop = `${bound}-${axis}`;
            const shown = ctx.computed[prop];
            return (
              <PInput key={prop} aria-label={`${bound === 'min' ? 'Min' : 'Max'} ${axis}`} prefix={axis === 'width' ? 'W' : 'H'} min={0} unit="px"
                value={withoutUnit(ctx.inline[prop])} placeholder={!shown || shown === 'none' || shown === 'auto' ? (bound === 'min' ? '0' : 'None') : roundPx(shown)} disabled={ctx.locked}
                onCommit={(next) => ctx.set({ [prop]: next || null })} />
            );
          })}
        </PRow>
      ))}
      {/* Self alignment has no row of its own: it shows only once the element's style sets it. */}
      {(['align-self', 'justify-self'] as const).map((prop) => {
        const written = ctx.inline[prop]?.trim();
        if (!written) return null;
        const { label, options } = SELF_ALIGN[prop];
        const known = options.some((option) => option.value === written);
        return (
          <PRow key={prop} label={label}>
            <PSelect aria-label={label} value={written} options={known ? options : [...options, { value: written, label: written }]} disabled={ctx.locked} onChange={(next) => ctx.set({ [prop]: next })} />
          </PRow>
        );
      })}
    </PSection>
  );
}

/* --------------------------------- layout --------------------------------- */

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Expands a 1–4 value shorthand into top/right/bottom/left. */
function expandSides(value: string | undefined): [string, string, string, string] | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/);
  const [a, b = a, c = a, d = b] = parts as [string, string?, string?, string?];
  return [a, b!, c!, d!];
}

/** Props of {@link SidesField}. */
interface SidesFieldProps {
  label: string;
  /** The one field's name; each side's is `sideName(side)`. */
  name: string;
  sideName: (side: (typeof SIDES)[number]) => string;
  written: string[];
  rendered: string[];
  min?: number;
  disabled: boolean;
  /** The toggle's name, collapsed and expanded. */
  toggle: [string, string];
  /** Why the sides can't be set one by one, when they can't. */
  toggleWhy?: string | null;
  /** Shown in the one field while the sides differ. */
  differ?: string;
  /** Starts again (collapsed or not) when this changes. */
  resetKey: unknown;
  onOne: (value: string) => void;
  onSides: (values: string[]) => void;
}

/** One value for all four sides, or a field per side behind a toggle; open while the sides differ. */
function SidesField({ label, name, sideName, written, rendered, min, disabled, toggle: [expand, collapse], toggleWhy, differ, resetKey, onOne, onSides }: SidesFieldProps) {
  const uniform = written.every((v) => v === written[0]) && (written[0] !== '' || rendered.every((v) => v === rendered[0]));
  const [open, setOpen] = useState(!uniform && !toggleWhy);
  useEffect(() => setOpen(!uniform && !toggleWhy), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const split = open && !toggleWhy;
  const limits = min === undefined ? {} : { min };
  const tip = toggleWhy ?? (split ? collapse : expand);
  const button = (
    <Tip label={tip} side="top">
      <span className="inline-flex">
        <PIconButton label={expand === 'Individual sides' ? expand : split ? collapse : expand} pressed={split} disabled={disabled || Boolean(toggleWhy)} onClick={() => setOpen(!split)}>
          <Scan {...ICON} />
        </PIconButton>
      </span>
    </Tip>
  );
  if (!split) {
    return (
      <PRow label={label}>
        <PInput aria-label={name} {...limits} value={uniform ? withoutUnit(written[0]) : ''} placeholder={uniform ? rendered[0] : (differ ?? rendered[0])} unit="px" disabled={disabled} onCommit={onOne} />
        {button}
      </PRow>
    );
  }
  return (
    <PRow label={label} className="items-start py-1">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
        {SIDES.map((side, i) => (
          <PInput
            key={side}
            aria-label={sideName(side)}
            {...limits}
            prefix={side[0]!.toUpperCase()}
            value={withoutUnit(written[i])}
            placeholder={rendered[i]}
            unit="px"
            disabled={disabled}
            onCommit={(next) => onSides(written.map((v, j) => (j === i ? next : v)))}
          />
        ))}
      </div>
      {button}
    </PRow>
  );
}

function SidesRow({ ctx, prop, label }: { ctx: ElementContext; prop: 'padding' | 'margin'; label: string }) {
  const short = expandSides(ctx.inline[prop]);
  const written = SIDES.map((side, i) => ctx.inline[`${prop}-${side}`] ?? short?.[i] ?? '');
  const rendered = SIDES.map((side) => roundPx(ctx.computed[`${prop}-${side}`]));
  return (
    <SidesField
      label={label}
      name={label}
      sideName={(side) => `${label} ${side}`}
      written={written}
      rendered={rendered}
      // Padding takes no negative numbers; margin does.
      {...(prop === 'padding' ? { min: 0 } : {})}
      disabled={ctx.locked}
      toggle={['Individual sides', 'Same on all sides']}
      resetKey={ctx.element}
      onOne={(next) => {
        const patch: Record<string, string | null> = { [prop]: next || null };
        for (const side of SIDES) patch[`${prop}-${side}`] = null;
        ctx.set(patch);
      }}
      onSides={(values) => {
        const patch: Record<string, string | null> = { [prop]: null };
        SIDES.forEach((side, i) => (patch[`${prop}-${side}`] = values[i] || null));
        ctx.set(patch);
      }}
    />
  );
}

const DISPLAYS: POption[] = [
  { value: 'block', label: 'Block' },
  { value: 'flex', label: 'Flex' },
  { value: 'grid', label: 'Grid' },
  { value: 'inline', label: 'Inline' },
  { value: 'inline-block', label: 'Inline block' },
  { value: 'inline-flex', label: 'Inline flex' },
  { value: 'none', label: 'Hidden' },
];
const JUSTIFY: POption[] = [
  { value: 'flex-start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'flex-end', label: 'End' },
  { value: 'space-between', label: 'Space between' },
  { value: 'space-around', label: 'Space around' },
  { value: 'space-evenly', label: 'Space evenly' },
];
const ALIGN_ITEMS: POption[] = [
  { value: 'stretch', label: 'Stretch' },
  { value: 'flex-start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'flex-end', label: 'End' },
  { value: 'baseline', label: 'Baseline' },
];
const normalAlign = (value: string | undefined) => (value === 'normal' ? 'stretch' : value === 'start' ? 'flex-start' : value === 'end' ? 'flex-end' : value ?? null);

const ALIGN_ICONS: Record<AlignAction, ReactNode> = {
  left: <AlignStartVertical {...ICON} />,
  hcenter: <AlignCenterVertical {...ICON} />,
  right: <AlignEndVertical {...ICON} />,
  top: <AlignStartHorizontal {...ICON} />,
  vcenter: <AlignCenterHorizontal {...ICON} />,
  bottom: <AlignEndHorizontal {...ICON} />,
};

/**
 * The align row: several positioned elements line up with each other;
 * otherwise offsets (positioned) or auto margins (in the flow) line the
 * selection up inside its parent. Each action also has its ⌥-letter.
 */
function AlignRow({ ctx }: { ctx: ElementContext }) {
  useView((s) => s.selection);
  useView((s) => s.layoutTick);
  useDocument((s) => s.boards[ctx.board]?.source);
  const blocked = ctx.lockedWhy ?? (ctx.locked && !useDocument.getState().readOnly ? 'This element’s style comes from code' : null);
  const mode = alignMode(blocked);
  if (!mode) return null;
  return (
    <div role="group" aria-label="Align items" className="flex h-7 items-center justify-between pl-3 pr-2">
      {ALIGN_ACTIONS.map(({ action, label }) => {
        const state = mode.kind === 'parent' ? mode.actions[action] : null;
        const reason = state?.reason ?? null;
        return (
          <PTipButton
            key={action}
            tip={reason ? alignTip(action, reason) : label}
            shortcut={reason ? undefined : alignShortcut(action)}
            label={label}
            pressed={state?.on ?? false}
            disabled={reason !== null}
            onClick={() => runAlign(action)}
          >
            {ALIGN_ICONS[action]}
          </PTipButton>
        );
      })}
    </div>
  );
}

function LayoutSection({ ctx }: { ctx: ElementContext }) {
  const display = ctx.inline.display ?? ctx.computed.display ?? 'block';
  const position = ctx.inline.position ?? ctx.computed.position ?? 'static';
  const flex = display.includes('flex');
  const grid = display.includes('grid');
  const direction = (ctx.inline['flex-direction'] ?? ctx.computed['flex-direction'] ?? 'row').startsWith('column') ? 'column' : 'row';
  return (
    <PSection title="Layout">
      <AlignRow ctx={ctx} />
      {position !== 'static' ? (
        <PRow label="Offsets" className="items-start py-1">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
            {(['left', 'top', 'right', 'bottom'] as const).map((side) => (
              <PInput
                key={side}
                aria-label={side}
                prefix={side[0]!.toUpperCase()}
                value={withoutUnit(ctx.inline[side])}
                placeholder={ctx.computed[side] === 'auto' ? 'auto' : roundPx(ctx.computed[side])}
                unit="px"
                disabled={ctx.locked}
                onCommit={(next) => ctx.set({ [side]: next || null })}
              />
            ))}
          </div>
        </PRow>
      ) : null}
      <SidesRow ctx={ctx} prop="padding" label="Padding" />
      <SidesRow ctx={ctx} prop="margin" label="Margin" />
      <PRow label="Display">
        <PSelect aria-label="Display" value={DISPLAYS.some((d) => d.value === display) ? display : null} placeholder={display} options={DISPLAYS} disabled={ctx.locked} onChange={(next) => ctx.set({ display: next })} />
      </PRow>
      {flex ? (
        <>
          <PRow label="Direction">
            <PSegments
              value={direction}
              disabled={ctx.locked}
              className="flex-1"
              options={[
                { value: 'row', label: 'Row', icon: <ArrowRight className="size-3.5" /> },
                { value: 'column', label: 'Column', icon: <ArrowDown className="size-3.5" /> },
              ]}
              onChange={(next) => ctx.set({ 'flex-direction': next === 'row' ? null : next })}
            />
            <PSelect
              aria-label="Wrap"
              value={(ctx.inline['flex-wrap'] ?? ctx.computed['flex-wrap']) === 'wrap' ? 'wrap' : 'nowrap'}
              options={[
                { value: 'nowrap', label: 'No wrap' },
                { value: 'wrap', label: 'Wrap' },
              ]}
              disabled={ctx.locked}
              className="w-[92px] shrink-0"
              onChange={(next) => ctx.set({ 'flex-wrap': next === 'wrap' ? 'wrap' : null })}
            />
          </PRow>
          <PRow label="Justify">
            <PSelect aria-label="Justify content" value={normalAlign(ctx.inline['justify-content'] ?? ctx.computed['justify-content'])} options={JUSTIFY} disabled={ctx.locked} onChange={(next) => ctx.set({ 'justify-content': next })} />
          </PRow>
          <PRow label="Align">
            <PSelect aria-label="Align items" value={normalAlign(ctx.inline['align-items'] ?? ctx.computed['align-items'])} options={ALIGN_ITEMS} disabled={ctx.locked} onChange={(next) => ctx.set({ 'align-items': next })} />
          </PRow>
        </>
      ) : null}
      {grid ? (
        <>
          {(['grid-template-columns', 'grid-template-rows'] as const).map((prop) => {
            const columns = prop === 'grid-template-columns';
            const shown = ctx.computed[prop];
            const count = trackCount(shown);
            return (
              <PRow key={prop} label={columns ? 'Columns' : 'Rows'}>
                <Tip label={columns ? COLUMNS_TIP : ROWS_TIP} side="top">
                  <span className="min-w-0 flex-1">
                    <PInput aria-label={columns ? 'Grid columns' : 'Grid rows'} mono value={tracksShown(ctx.inline[prop])}
                      placeholder={!shown || shown === 'none' ? (columns ? '1' : 'Auto') : count === null ? shown.split(' ').length.toString() : String(count)}
                      disabled={ctx.locked} onCommit={(next) => ctx.set({ [prop]: tracksValue(next) })} />
                  </span>
                </Tip>
              </PRow>
            );
          })}
        </>
      ) : null}
      {flex || grid ? (
        <PRow label="Gap">
          <PInput aria-label="Gap" min={0} value={withoutUnit(ctx.inline.gap)} placeholder={roundPx(ctx.computed['row-gap'] ?? ctx.computed.gap)} unit="px" disabled={ctx.locked} onCommit={(next) => ctx.set({ gap: next || null })} />
        </PRow>
      ) : null}
    </PSection>
  );
}

/* ---------------------------------- text ---------------------------------- */

const WEIGHTS: POption[] = [
  ['100', 'Thin'],
  ['200', 'Extra light'],
  ['300', 'Light'],
  ['400', 'Regular'],
  ['500', 'Medium'],
  ['600', 'Semibold'],
  ['700', 'Bold'],
  ['800', 'Extra bold'],
  ['900', 'Black'],
].map(([value, label]) => ({ value: value!, label: label! }));

const normalWeight = (value: string | undefined) => (value === 'normal' ? '400' : value === 'bold' ? '700' : value ?? null);

/**
 * Fonts offered beyond those the design already uses. Only those that render
 * on this computer are listed: any other shows in a substitute face.
 */
const ALL_FONTS: [string, string][] = [
  ['Inter', 'sans-serif'],
  ['Helvetica Neue', 'sans-serif'],
  ['Arial', 'sans-serif'],
  ['system-ui', ''],
  ['Roboto', 'sans-serif'],
  ['PingFang SC', 'sans-serif'],
  ['Noto Sans SC', 'sans-serif'],
  ['Noto Serif SC', 'serif'],
  ['Georgia', 'serif'],
  ['Times New Roman', 'serif'],
  ['Playfair Display', 'serif'],
  ['JetBrains Mono', 'monospace'],
  ['Menlo', 'monospace'],
];

/** The first family of a font-family list, unquoted. */
const firstFamily = (value: string | undefined) => (value ?? '').split(',')[0]!.trim().replace(/^["']|["']$/g, '');
const familyCss = (name: string, fallback: string) => (fallback ? `${/\s/.test(name) ? `"${name}"` : name}, ${fallback}` : name);

/** Font stacks written anywhere in the artboard. */
function fontsInDesign(source: string): string[] {
  const out = new Map<string, string>();
  for (const match of source.matchAll(/font-family\s*:\s*([^;"}]+|"[^"]*"[^;}]*)/gi)) {
    const css = match[1]!.trim().replace(/&quot;/g, '"');
    const name = firstFamily(css);
    if (name && !out.has(name)) out.set(name, css);
  }
  return [...out.values()];
}

const PRESET_TAGS: [string, string][] = [
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['h4', 'Heading 4'],
  ['h5', 'Heading 5'],
  ['h6', 'Heading 6'],
  ['p', 'Body'],
  ['small', 'Caption'],
];

/** Text styles of the artboard: the rendered size and font of the first of each tag. */
function useTextPresets(ctx: ElementContext): { name: string; tag: string; size: string; family: string }[] {
  const tick = useView((s) => s.layoutTick);
  return useMemo(() => {
    const api = boardApi(ctx.board);
    const out: { name: string; tag: string; size: string; family: string }[] = [];
    for (const [tag, name] of PRESET_TAGS) {
      const element = ctx.model.elements.find((e) => e.tag === tag);
      if (!element) continue;
      const computed = api?.inspect(ctx.model.tidOf.get(element)!)?.computed;
      if (computed?.['font-size']) out.push({ name, tag, size: computed['font-size'], family: computed['font-family'] ?? '' });
    }
    return out;
  }, [ctx.board, ctx.model, tick]);
}

function TextSection({ ctx, source }: { ctx: ElementContext; source: string }) {
  const presets = useTextPresets(ctx);
  const swatches = useSystemSwatches();
  const systemStyles = useSystemTextStyles();
  const systems = useDesignSystems((s) => s.systems);
  const size = ctx.computed['font-size'];
  const family = ctx.inline['font-family'] ?? ctx.computed['font-family'] ?? '';
  const systemStyle = ctx.inline['font-size'] ? matchSystemStyle(systems, ctx.inline) : undefined;
  const preset = systemStyle
    ? undefined
    : (presets.find((p) => p.tag === ctx.element.tag && !ctx.inline['font-size'] && !ctx.inline['font-family']) ??
      presets.find((p) => p.size === size && firstFamily(p.family) === firstFamily(family)));
  const styleOptions: POption[] = [
    ...presets.map((p) => ({ value: p.name, label: `${p.name} · ${roundPx(p.size)}`, ...(systemStyles.length ? { group: 'In this artboard' } : {}) })),
    ...systemStyles.map((style) => ({ value: style.id, label: `${style.name} · ${roundPx(style.declarations['font-size'])}`, group: style.system })),
    ...(preset || systemStyle ? [] : [{ value: 'custom', label: 'Custom' }]),
  ];

  const designFonts = useMemo(() => fontsInDesign(source), [source]);
  const designNames = new Set(designFonts.map(firstFamily));
  const fontOptions: (POption & { css: string })[] = [
    ...designFonts.map((css) => ({ value: firstFamily(css), label: firstFamily(css), css, group: 'In this design', style: { fontFamily: css } })),
    ...ALL_FONTS.filter(([name]) => !designNames.has(name) && isFontAvailable(name)).map(([name, fallback]) => ({ value: name, label: name, css: familyCss(name, fallback), group: 'All fonts', style: { fontFamily: familyCss(name, fallback) } })),
  ];
  const currentFont = firstFamily(family);

  return (
    <PSection title="Text">
      <PRow label="Style">
        <PSelect
          aria-label="Text style"
          value={systemStyle?.id ?? preset?.name ?? 'custom'}
          options={styleOptions}
          disabled={ctx.locked || (!presets.length && !systemStyles.length)}
          onChange={(name) => {
            const fromSystem = styleById(systems, name);
            if (fromSystem) {
              ctx.set(systemStylePatch(fromSystem));
              return;
            }
            const picked = presets.find((p) => p.name === name);
            if (picked) ctx.set({ 'font-size': picked.size, 'font-family': picked.family || null, 'line-height': null, 'letter-spacing': null, 'font-weight': null, 'font-style': null });
          }}
        />
      </PRow>
      <PRow label="Font">
        <PSearchSelect
          aria-label="Font"
          searchLabel="Search fonts"
          value={fontOptions.some((f) => f.value === currentFont) ? currentFont : null}
          placeholder={currentFont || 'Default'}
          options={fontOptions}
          disabled={ctx.locked}
          onChange={(name) => ctx.set({ 'font-family': fontOptions.find((f) => f.value === name)?.css ?? name })}
        />
      </PRow>
      <PRow label="Weight">
        <PSelect aria-label="Font weight" value={normalWeight(ctx.inline['font-weight'] ?? ctx.computed['font-weight'])} options={WEIGHTS} disabled={ctx.locked} onChange={(next) => ctx.set({ 'font-weight': next })} />
        <PInput aria-label="Font size" min={1} max={400} className="w-[76px] shrink-0" value={withoutUnit(ctx.inline['font-size'])} placeholder={roundPx(size)} unit="px" disabled={ctx.locked} onCommit={(next) => ctx.set({ 'font-size': next || null })} />
      </PRow>
      <PRow label="Spacing">
        <Tip label="Line height" side="top">
          <span className="min-w-0 flex-1">
            <PInput aria-label="Line height" prefix="↕" min={0} step={0.05} value={ctx.inline['line-height'] ?? ''} placeholder={ctx.computed['line-height'] === 'normal' ? 'Auto' : roundPx(ctx.computed['line-height'])} disabled={ctx.locked} onCommit={(next) => ctx.set({ 'line-height': next || null })} />
          </span>
        </Tip>
        <Tip label="Letter spacing" side="top">
          <span className="min-w-0 flex-1">
            <PInput aria-label="Letter spacing" prefix="↔" value={ctx.inline['letter-spacing'] ?? ''} placeholder={ctx.computed['letter-spacing'] === 'normal' ? '0' : roundPx(ctx.computed['letter-spacing'])} disabled={ctx.locked} onCommit={(next) => ctx.set({ 'letter-spacing': next || null })} />
          </span>
        </Tip>
      </PRow>
      <TextColorRows ctx={ctx} swatches={swatches} />
      <PRow label="Align">
        <PSegments
          className="flex-1"
          disabled={ctx.locked}
          value={(ctx.inline['text-align'] ?? ctx.computed['text-align'] ?? 'left').replace('start', 'left').replace('end', 'right')}
          options={[
            { value: 'left', label: 'Left', icon: <AlignLeft className="size-3.5" /> },
            { value: 'center', label: 'Center', icon: <AlignCenter className="size-3.5" /> },
            { value: 'right', label: 'Right', icon: <AlignRight className="size-3.5" /> },
            { value: 'justify', label: 'Justify', icon: <AlignJustify className="size-3.5" /> },
          ]}
          onChange={(next) => ctx.set({ 'text-align': next })}
        />
        <PIconButton label="Italic" pressed={(ctx.inline['font-style'] ?? ctx.computed['font-style']) === 'italic'} disabled={ctx.locked} onClick={() => ctx.set({ 'font-style': ctx.inline['font-style'] === 'italic' ? null : 'italic' })}>
          <Italic className="size-3.5" />
        </PIconButton>
      </PRow>
    </PSection>
  );
}

/**
 * Text › Color: a solid color, or a gradient painted through the glyphs
 * (the background clipped to the text). Picking the gradient starts from
 * the one used last, else from the text's color.
 */
function TextColorRows({ ctx, swatches }: { ctx: ElementContext; swatches: readonly PSwatch[] }) {
  const clipped = clipsToText(ctx.inline, ctx.computed);
  const gradient = textGradientOf(ctx.inline, ctx.computed);
  const drag = useRef<string | null>(null);
  // The gradient this element had, so going back to Gradient after Solid brings it back; another element starts afresh.
  const last = useRef<{ key: string; gradient: string } | null>(null);
  const key = `${ctx.board}:${ctx.model.tidOf.get(ctx.element)}`;
  if (gradient) last.current = { key, gradient };
  const paint = (css: string, coalesce?: string) => ctx.set(textGradientPatch(ctx.inline, css), coalesce ? { coalesce } : {});
  const pick = (kind: 'solid' | 'gradient') => {
    if (kind === (clipped ? 'gradient' : 'solid')) return;
    if (kind === 'gradient') {
      const before = last.current?.key === key ? last.current.gradient : null;
      paint(initialGradient({ inline: ctx.inline.color, computed: ctx.computed.color }, true, before));
      return;
    }
    const color = ctx.inline.color ?? (gradient ? firstStopOf(gradient) : null) ?? null;
    ctx.set(solidTextPatch(ctx.inline, color));
  };
  return (
    <>
      <PRow label="Color">
        <PSegments<'solid' | 'gradient'>
          className="w-[56px] shrink-0"
          value={clipped ? 'gradient' : 'solid'}
          disabled={ctx.locked}
          options={[
            { value: 'solid', label: 'Solid color', icon: <Square className="size-3" /> },
            { value: 'gradient', label: 'Gradient', icon: <Blend className="size-3" /> },
          ]}
          onChange={pick}
        />
        {clipped ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-chrome-muted">{gradient ?? 'Background'}</span>
        ) : (
          <PColor aria-label="Text color" swatches={swatches} value={ctx.inline.color ?? ''} placeholder={ctx.computed.color} disabled={ctx.locked} onCommit={(next) => ctx.set({ color: next || null })} />
        )}
      </PRow>
      {clipped && !ctx.locked ? (
        <div className="px-3 pb-2">
          <GradientEditor
            aria-label="Text gradient"
            value={gradient ?? ctx.inline.background ?? ctx.inline['background-image'] ?? ''}
            swatches={swatches.map((swatch) => ({ name: swatch.label, value: swatch.color, group: swatch.group, css: swatch.value }))}
            onChange={(css) => {
              drag.current ??= `text-gradient-${++dragSerial}`;
              paint(css, drag.current);
            }}
            onCommit={(css) => {
              paint(css, drag.current ?? undefined);
              drag.current = null;
            }}
          />
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------- appearance ------------------------------- */

/** Remove fill: shown while there is a fill to remove (a shape's or a single-shape graphic's too). */
function RemoveFillButton({ ctx }: { ctx: ElementContext }) {
  const subject = ctx.element.tag === 'svg' ? (loneShapeOf(ctx.element) ?? ctx.element) : ctx.element;
  if (ctx.locked || !removableFill(subject, ctx.computed)) return null;
  return (
    <PTipButton tip="Remove fill" label="Remove fill" onClick={() => removeFill()}>
      <Ban className="size-3.5" strokeWidth={1.75} />
    </PTipButton>
  );
}

/** The image layers of a background (a gradient or picture), as written: the shorthand, or `background-image`. */
function LayersRow({ ctx }: { ctx: ElementContext }) {
  const background = ctx.inline.background;
  const layered = (value: string | undefined) => value !== undefined && /gradient|url\(/.test(value);
  if (layered(background)) {
    return (
      <PRow label="Background">
        <PInput aria-label="Background" mono value={background!} disabled={ctx.locked} onCommit={(next) => ctx.set({ background: next || null })} />
      </PRow>
    );
  }
  const image = ctx.inline['background-image'];
  if (!layered(image)) return null;
  return (
    <PRow label="Background">
      <PInput aria-label="Background image" mono value={image!} disabled={ctx.locked} onCommit={(next) => ctx.set({ 'background-image': next || null, ...(next ? {} : { 'background-size': null }) })} />
    </PRow>
  );
}

const BORDER_STYLE_OPTIONS = ELEMENT_BORDER_STYLES.map((value) => ({
  value,
  label: value === 'none' ? 'No border' : value[0]!.toUpperCase() + value.slice(1),
  icon: value === 'none' ? <Ban className="size-3.5" strokeWidth={1.75} /> : <span aria-hidden className="block h-0 w-4" style={{ borderTop: `${value === 'double' ? 3 : 2}px ${value} currentColor` }} />,
}));

/**
 * The border: its style as segments (with the alignment button), then its
 * color and width once it has a style. Each side's width is set only on a
 * border aligned inside. An aligned border shows (and edits) the outline
 * that draws it.
 */
function BorderRows({ ctx }: { ctx: ElementContext }) {
  const swatches = useSystemSwatches();
  const { look } = readAlignment(ctx.inline, ctx.computed);
  const style = look?.style ?? borderStyleOf(ctx.inline, ctx.computed);
  const styled = style !== 'none' && style !== 'hidden';
  const aligned = (change: Partial<BorderLook>) => editSelectedAlignedBorder(change);
  const written = look ? [look.width, look.width, look.width, look.width] : borderWidthsOf(ctx.inline);
  const rendered = SIDES.map((side) => roundPx(ctx.computed[`border-${side}-width`]));
  const computedColor = ctx.computed['border-top-color'];
  return (
    <>
      <PRow label={styled ? 'Border' : 'No border'}>
        <PSegments
          className="flex-1"
          value={(ELEMENT_BORDER_STYLES as readonly string[]).includes(style) ? (style as BorderStyle) : null}
          options={BORDER_STYLE_OPTIONS}
          disabled={ctx.locked}
          onChange={(next) => (look ? aligned({ style: next }) : ctx.set(borderStylePatch(ctx.inline, ctx.computed, next)))}
        />
        <BorderAlignButton element={ctx.element} computed={ctx.computed} disabled={ctx.locked} />
      </PRow>
      {styled ? (
        <>
          <PRow label="Color">
            <PColor aria-label="Border color" swatches={swatches} value={look?.color ?? borderColorOf(ctx.inline)} placeholder={toHex(computedColor) ?? computedColor ?? ''} disabled={ctx.locked}
              onCommit={(next) => (look ? aligned({ color: next }) : ctx.set(borderColorPatch(ctx.inline, next)))} />
          </PRow>
          <SidesField
            label="Width"
            name="Border width"
            sideName={(side) => `Width ${side}`}
            written={written}
            rendered={rendered}
            min={0}
            disabled={ctx.locked}
            toggle={['Edit width per side', 'Hide width per side']}
            toggleWhy={look ? SIDES_NEED_INSIDE : null}
            differ={WIDTHS_DIFFER}
            resetKey={ctx.element}
            onOne={(next) => (look ? aligned({ width: next }) : ctx.set(borderWidthPatch(ctx.inline, next)))}
            onSides={(values) => ctx.set(borderSidesPatch(ctx.inline, values))}
          />
        </>
      ) : null}
    </>
  );
}

/** The look a slider has in the panel. */
const PANEL_SLIDER: SliderLook = {
  root: 'flex h-6 min-w-0 flex-1 items-center px-1 data-[disabled]:opacity-40',
  track: 'h-[3px] w-full rounded-full bg-chrome-selected',
  indicator: 'rounded-full bg-chrome-accent',
  thumb: 'size-3.5 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_1px_3px_rgb(0_0_0/0.2)] outline-none focus-visible:outline-2 focus-visible:outline-[#257de0]',
};

/** A drag's edits share one key, so the drag is one undo step. */
let dragSerial = 0;

/** Opacity: a percentage field and a slider; a drag writes as it goes and is one undo step. */
/** The rendered opacity of each selected element of the artboard, when several are selected. */
function useSelectedOpacities(ctx: ElementContext): number[] {
  const selection = useView((s) => s.selection);
  const tick = useView((s) => s.layoutTick);
  const source = useDocument((s) => s.boards[ctx.board]?.source);
  return useMemo(() => {
    if (selection.kind !== 'elements' || selection.items.length < 2) return [];
    const api = boardApi(ctx.board);
    return selection.items.map(({ tid }) => Math.round(num(api?.inspect(tid)?.computed.opacity ?? '1') * 100));
  }, [selection, tick, source, ctx.board]); // eslint-disable-line react-hooks/exhaustive-deps
}

function OpacityRow({ ctx, opacity }: { ctx: ElementContext; opacity: string | undefined }) {
  const all = useSelectedOpacities(ctx);
  // Several elements with different opacities: the field is empty and says so; a value typed or dragged goes to all of them.
  const mixed = all.some((value) => value !== all[0]);
  const shown = Math.round(num(opacity ?? ctx.computed.opacity ?? '1') * 100);
  const drag = useRef<string | null>(null);
  const write = (value: number, coalesce?: string) => ctx.set({ opacity: value >= 100 ? null : String(Math.max(0, value) / 100) }, coalesce ? { coalesce } : {});
  return (
    <PRow label="Opacity">
      <PInput
        aria-label="Opacity"
        className="w-[68px] shrink-0"
        min={0}
        max={100}
        numeric
        value={mixed || opacity === undefined ? '' : String(shown)}
        placeholder={mixed ? 'Mixed' : String(shown)}
        unit="%"
        disabled={ctx.locked}
        onCommit={(next) => {
          const value = num(next);
          ctx.set({ opacity: !next || !Number.isFinite(value) || value >= 100 ? null : String(Math.max(0, value) / 100) });
        }}
      />
      <SliderInput
        aria-label="Opacity slider"
        look={PANEL_SLIDER}
        unit="%"
        min={0}
        max={100}
        value={shown}
        mixed={mixed}
        disabled={ctx.locked}
        onChange={(value) => {
          drag.current ??= `opacity-drag-${++dragSerial}`;
          write(value, drag.current);
        }}
        onCommit={(value) => {
          write(value, drag.current ?? undefined);
          drag.current = null;
        }}
      />
    </PRow>
  );
}

function AppearanceSection({ ctx }: { ctx: ElementContext }) {
  const swatches = useSystemSwatches();
  const background = ctx.inline.background;
  const plainBackground = background !== undefined && !/gradient|url\(/.test(background);
  const fill = ctx.inline['background-color'] ?? (plainBackground ? background : '') ?? '';
  const computedFill = isTransparent(ctx.computed['background-color']) ? undefined : ctx.computed['background-color'];
  const opacity = ctx.inline.opacity;
  // The background paints the text: it is the text's color, edited under Text › Color.
  const textFill = clipsToText(ctx.inline, ctx.computed);
  return (
    <PSection title="Appearance">
      <PRow label="Fill" title={textFill ? FILL_IS_TEXT : undefined}>
        <span className="contents" data-reason={textFill ? 'fill' : undefined} title={textFill ? FILL_IS_TEXT : undefined}>
          <PColor
            aria-label="Fill"
            swatches={swatches}
            value={textFill || isClearColor(fill) ? '' : fill}
            placeholder={textFill ? 'Text' : (computedFill ?? 'None')}
            disabled={ctx.locked || textFill}
            onCommit={(next) => ctx.set(fillColorPatch(ctx.inline, ctx.computed, next || null))}
          />
        </span>
        <RemoveFillButton ctx={ctx} />
      </PRow>
      {textFill ? <PNote className="pt-0">{FILL_IS_TEXT}</PNote> : <LayersRow ctx={ctx} />}
      <OpacityRow ctx={ctx} opacity={opacity} />
      <PRow label="Radius">
        <PInput aria-label="Corner radius" prefix="◜" min={0} value={withoutUnit(ctx.inline['border-radius'])} placeholder={roundPx(ctx.computed['border-top-left-radius'])} unit="px" disabled={ctx.locked} onCommit={(next) => {
          ctx.set({ 'border-radius': next || null });
          if (next) rememberRadius(next);
        }} />
      </PRow>
      <BorderRows ctx={ctx} />
      <PRow label="Clip">
        <PSelect
          aria-label="Overflow"
          value={(ctx.inline.overflow ?? ctx.computed.overflow ?? 'visible').split(' ')[0]!}
          options={[
            { value: 'visible', label: 'Show overflow' },
            { value: 'hidden', label: 'Clip content' },
            { value: 'auto', label: 'Scroll' },
          ]}
          disabled={ctx.locked}
          onChange={(next) => ctx.set({ overflow: next === 'visible' ? null : next })}
        />
      </PRow>
    </PSection>
  );
}

function EffectsSection({ ctx }: { ctx: ElementContext }) {
  const shadow = ctx.computed['box-shadow'];
  return (
    <PSection title="Effects">
      <PRow label="Shadow">
        <PInput aria-label="Shadow" value={ctx.inline['box-shadow'] ?? ''} placeholder={!shadow || shadow === 'none' ? 'None' : shadow} disabled={ctx.locked} onCommit={(next) => ctx.set({ 'box-shadow': next || null })} />
      </PRow>
      <PRow label="Transform" title={ctx.lockedWhy ?? undefined}>
        <PInput aria-label="Transform" value={ctx.inline.transform ?? ''} placeholder={!ctx.computed.transform || ctx.computed.transform === 'none' ? 'None' : ctx.computed.transform} disabled={ctx.locked || ctx.lockedWhy !== null} onCommit={(next) => ctx.set({ transform: next || null })} />
      </PRow>
    </PSection>
  );
}

function AttributesSection({ ctx, many, readOnly }: { ctx: ElementContext; many: boolean; readOnly: boolean }) {
  const names = (ctx.element.tag === 'img' ? ['src', 'alt'] : ctx.element.tag === 'a' ? ['href'] : []).concat(['id', 'class']);
  const target = { tid: ctx.model.tidOf.get(ctx.element)!, path: elementPath(ctx.model, ctx.element) };
  return (
    <PSection title="Attributes">
      {names.map((name) => (
        <PRow key={name} label={name}>
          <PInput aria-label={name} mono value={attributeValue(ctx.element, name) ?? ''} disabled={readOnly || many} onCommit={(value) => edit(ctx.board, { kind: 'attr', target, name, value: value === '' ? null : value })} />
        </PRow>
      ))}
    </PSection>
  );
}

/* ------------------------------ element context ---------------------------- */

/** Resolves the first selected element and what the sections need. */
function useElementContext(board: string): (ElementContext & { many: boolean; dynamic: boolean; source: string }) | null {
  const selection = useView((s) => s.selection);
  const layoutTick = useView((s) => s.layoutTick);
  const source = useDocument((s) => s.boards[board]?.source ?? null);
  const readOnly = useDocument((s) => s.readOnly);
  const first = selection.kind === 'elements' ? selection.items[0] : undefined;
  const model = useMemo(() => (source ? templateOf(source) : null), [source]);
  const element = useMemo(() => (model && first ? resolveElement(model, first.tid, first.path) : null), [model, first]);
  const inspection = useMemo(() => (first ? (boardApi(board)?.inspect(first.tid) ?? null) : null), [board, first, source, layoutTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const lockedWhy = useLockedWhy();
  if (!element || !model || !source || selection.kind !== 'elements') return null;
  const dynamic = hasDynamicStyle(element);
  const locked = dynamic || readOnly;
  return {
    board,
    model,
    element,
    source,
    inline: styleMap(attributeValue(element, 'style') ?? ''),
    computed: inspection?.computed ?? {},
    inspection,
    locked,
    lockedWhy,
    dynamic,
    many: selection.items.length > 1,
    set: (patch, options) => {
      if (!locked) styleSelection(patch, options);
    },
  };
}

function ElementInspector({ board }: { board: string }) {
  const ctx = useElementContext(board);
  const readOnly = useDocument((s) => s.readOnly);
  if (!ctx) return <PNote>The element was not found. It may have been removed by another change.</PNote>;
  const texty = elementKind(ctx.element) === 'text';
  return (
    <div key={`${ctx.model.tidOf.get(ctx.element)}`}>
      {ctx.dynamic ? <PNote className="mx-3 mt-2 rounded-[8px] bg-chrome-hover text-chrome-secondary">This element’s style comes from code. Change it in Tweaks, or ask the agent.</PNote> : null}
      {ctx.lockedWhy ? <PNote className="mx-3 mt-2 rounded-[8px] bg-chrome-hover text-chrome-secondary">{ctx.lockedWhy}: its size, position and layout stay as they are.</PNote> : null}
      {/* Locked: the size and layout rows are disabled, the rest stays editable. */}
      <SizeSection ctx={ctx.lockedWhy ? { ...ctx, locked: true } : ctx} />
      <LayoutSection ctx={ctx.lockedWhy ? { ...ctx, locked: true } : ctx} />
      {texty ? <TextSection ctx={ctx} source={ctx.source} /> : null}
      {ctx.element.tag === 'img' || ctx.element.tag === 'video' ? <MediaSection ctx={ctx} readOnly={readOnly} /> : null}
      <AppearanceSection ctx={ctx} />
      <EffectsSection ctx={ctx} />
      <AttributesSection ctx={ctx} many={ctx.many} readOnly={readOnly} />
    </div>
  );
}

/* ------------------------------ board inspector ---------------------------- */

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange(on: boolean): void; disabled?: boolean; label: string }) {
  return (
    <span className="flex flex-1 justify-end">
      <SwitchInput aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </span>
  );
}

function BoardInspector({ path }: { path: string }) {
  const entry = useDocument((s) => s.canvas.boards[path]);
  const pages = useDocument((s) => s.canvas.pages);
  const readOnly = useDocument((s) => s.readOnly);
  const focus = useView((s) => s.focus);
  const focusRequest = useView((s) => s.focusRequest);
  const nameRow = useRef<HTMLDivElement>(null);
  // A new artboard placed from the keyboard: its name field takes focus.
  useEffect(() => {
    if (focusRequest !== `board-name:${path}`) return;
    const input = nameRow.current?.querySelector('input');
    if (!input) return;
    input.focus();
    input.select();
    useView.getState().requestFocus(null);
  }, [focusRequest, path, entry !== undefined]);
  if (!entry) return null;
  const lockedWhy = isLockedObject(entry) ? LOCKED_REASON : undefined;
  const number = (key: 'x' | 'y' | 'w' | 'h', label: string) => (
    <PInput
      aria-label={label}
      prefix={label}
      value={String(entry[key])}
      disabled={readOnly || Boolean(lockedWhy)}
      onCommit={(value) => {
        const n = num(value);
        if (Number.isFinite(n)) updateBoard(path, { [key]: Math.round(n) });
      }}
    />
  );
  return (
    <>
      <PSection title="Artboard">
        <div ref={nameRow} className="contents">
          <PRow label="Name">
            <PInput aria-label="Artboard name" value={entry.title ?? ''} placeholder={path} disabled={readOnly} onCommit={(value) => updateBoard(path, { title: value.trim() || undefined })} />
          </PRow>
        </div>
        <PRow label="Position" title={lockedWhy}>
          {number('x', 'X')}
          {number('y', 'Y')}
        </PRow>
        <PRow label="Size" title={lockedWhy}>
          {number('w', 'W')}
          {number('h', 'H')}
        </PRow>
        {pages.length > 1 ? (
          <PRow label="Page">
            <PSelect
              aria-label="Page"
              value={entry.page ?? pages[0]!.id}
              options={pages.map((p) => ({ value: p.id, label: p.name }))}
              disabled={readOnly}
              onChange={(value) => updateBoard(path, { page: value === pages[0]!.id ? undefined : value })}
            />
          </PRow>
        ) : null}
      </PSection>
      <PSection title="Appearance">
        {entry.frameless ? null : <BoardBackgroundRow paths={[path]} readOnly={readOnly} />}
        <PRow label="Radius">
          <PInput aria-label="Corner radius" min={0} value={entry.radius ? String(entry.radius) : ''} placeholder="0" unit="px" disabled={readOnly} onCommit={(value) => updateBoard(path, { radius: num(value) ? Math.round(num(value)) : undefined })} />
        </PRow>
      </PSection>
      <GuideInspector guides={entry.guides} readOnly={readOnly} change={guides => updateBoard(path, { guides: guides.length ? guides : undefined })} />
      <PSection title="Prototype">
        <PRow label="Interactive">
          <Switch label="Interactive" checked={Boolean(entry.is_interactive)} disabled={readOnly} onChange={(on) => updateBoard(path, { is_interactive: on || undefined })} />
        </PRow>
        <PRow label="Fill window">
          <Switch label="Fill the window when opened" checked={entry.expand === 'fill'} disabled={readOnly} onChange={(on) => updateBoard(path, { expand: on ? 'fill' : undefined })} />
        </PRow>
        <div className="flex gap-1.5 px-3 pt-1.5">
          <PButton onClick={() => focus(path)}>
            <Play className="size-3.5" /> Open
          </PButton>
          <PButton onClick={() => zoomToBoards([path])}>
            <Maximize2 className="size-3.5" /> Zoom to
          </PButton>
        </div>
      </PSection>
      <PNote className="font-mono text-[11px]">project/{path}</PNote>
    </>
  );
}

/**
 * The page background of the selected framed artboards (the `body` rule of
 * each page's stylesheet): a color, a gradient or a picture. Artboards that
 * differ read `Mixed`; a page that isn't loaded turns the row off.
 */
function BoardBackgroundRow({ paths, readOnly }: { paths: readonly string[]; readOnly: boolean }) {
  const swatches = useSystemSwatches();
  const sources = useDocument((s) => paths.map((path) => s.boards[path]?.source ?? '').join('\u0000'));
  const key = paths.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const values = useMemo(() => boardBackgrounds(paths), [sources, key]);
  if (!paths.length) return null;
  const value = values ? sharedValue(values, (each) => each) : '';
  return (
    <PRow label="Background" title={values ? (value === MIXED ? MIXED_ACROSS : undefined) : PAGE_UNREADABLE}>
      <PColor
        aria-label="Background"
        swatches={swatches}
        value={value === MIXED ? '' : value}
        placeholder={value === MIXED ? MIXED : undefined}
        disabled={readOnly || !values}
        onCommit={(next) => setBoardBackground(paths, next)}
      />
    </PRow>
  );
}

/** Changes several artboards' entries as one step. */
function updateBoards(change: (entry: BoardEntry) => Partial<BoardEntry>, paths: readonly string[]): void {
  useDocument.getState().updateCanvas((canvas) => {
    const boards = { ...canvas.boards };
    for (const path of paths) {
      const entry = boards[path];
      if (!entry) continue;
      const patch = change(entry);
      const next: BoardEntry = { ...entry, ...patch };
      for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
      boards[path] = next;
    }
    return { ...canvas, boards };
  });
}

/**
 * Several artboards: the rows they share. A value they differ in reads
 * `Mixed`; a number typed goes to each (a signed one, `+4`, changes each
 * from its own value). Position is off: canvas objects are placed by
 * dragging them.
 */
function BoardsInspector({ paths }: { paths: readonly string[] }) {
  const boards = useDocument((s) => s.canvas.boards);
  const pages = useDocument((s) => s.canvas.pages);
  const readOnly = useDocument((s) => s.readOnly);
  const entries = paths.flatMap((path) => (boards[path] ? [boards[path]] : []));
  if (!entries.length) return null;
  const lockedWhy = entries.some((entry) => isLockedObject(entry)) ? LOCKED_REASON : undefined;
  const sizeWhy = entries.some((entry) => entry.frameless) ? SIZED_BY_CONTENT : lockedWhy;
  const shown = (values: readonly (number | string | undefined)[], none = '') => sharedValue(values, (value) => (value === undefined ? none : String(value)));
  const mixedTitle = (value: string, why?: string) => why ?? (value === MIXED ? MIXED_ACROSS : undefined);
  const numberField = (key: 'x' | 'y' | 'w' | 'h', label: string, why: string | undefined) => {
    const value = shown(entries.map((entry) => entry[key]));
    return (
      <PInput
        aria-label={label}
        prefix={label}
        value={value === MIXED ? '' : value}
        placeholder={value === MIXED ? MIXED : undefined}
        disabled={readOnly || Boolean(why)}
        onCommit={(text) => {
          const change = typedChange(text);
          if (change) updateBoards((entry) => ({ [key]: changedBy(entry[key], change, key === 'w' || key === 'h' ? 1 : -Infinity) }), paths);
        }}
      />
    );
  };
  const page = shown(entries.map((entry) => entry.page ?? pages[0]?.id));
  const radius = shown(entries.map((entry) => entry.radius), '0');
  const sizes = [shown(entries.map((entry) => entry.w)), shown(entries.map((entry) => entry.h))];
  const guides = sharedGuides(entries);
  const interactive = shown(entries.map((entry) => String(Boolean(entry.is_interactive))));
  const fill = shown(entries.map((entry) => String(entry.expand === 'fill')));
  return (
    <>
      <PSection title={`${entries.length} artboards`}>
        <PRow label="Position" title={POSITION_ACROSS}>
          {numberField('x', 'X', POSITION_ACROSS)}
          {numberField('y', 'Y', POSITION_ACROSS)}
        </PRow>
        <PRow label="Size" title={mixedTitle(sizes.includes(MIXED) ? MIXED : '', sizeWhy)}>
          {numberField('w', 'W', sizeWhy)}
          {numberField('h', 'H', sizeWhy)}
        </PRow>
        {pages.length > 1 ? (
          <PRow label="Page" title={mixedTitle(page)}>
            <PSelect
              aria-label="Page"
              value={page === MIXED ? '' : page}
              placeholder={MIXED}
              options={pages.map((p) => ({ value: p.id, label: p.name }))}
              disabled={readOnly}
              onChange={(value) => value && updateBoards(() => ({ page: value === pages[0]!.id ? undefined : value }), paths)}
            />
          </PRow>
        ) : null}
      </PSection>
      <PSection title="Appearance">
        <BoardBackgroundRow paths={paths.filter((path) => boards[path] && !boards[path]!.frameless)} readOnly={readOnly} />
        <PRow label="Radius" title={mixedTitle(radius)}>
          <PInput
            aria-label="Corner radius"
            value={radius === MIXED || radius === '0' ? '' : radius}
            placeholder={radius === MIXED ? MIXED : '0'}
            unit="px"
            disabled={readOnly}
            onCommit={(text) => {
              const change = typedChange(text || '0');
              if (!change) return;
              const after = radiiAfter(entries.map((entry) => entry.radius), change);
              updateBoards((entry) => ({ radius: after[entries.indexOf(entry)] }), paths);
              announce(radiusSaid(after));
            }}
          />
        </PRow>
      </PSection>
      {guides ? (
        <GuideInspector guides={guides} readOnly={readOnly} change={(next) => updateBoards(() => ({ guides: next.length ? next : undefined }), paths)} />
      ) : (
        <PSection title="Layout guides">
          <PNote className="py-1">{GUIDES_DIFFER}</PNote>
        </PSection>
      )}
      <PSection title="Prototype">
        <PRow label="Interactive" title={mixedTitle(interactive)}>
          <Switch label="Interactive" checked={interactive === 'true'} disabled={readOnly} onChange={(on) => updateBoards(() => ({ is_interactive: on || undefined }), paths)} />
        </PRow>
        <PRow label="Fill window" title={mixedTitle(fill)}>
          <Switch label="Fill the window when opened" checked={fill === 'true'} disabled={readOnly} onChange={(on) => updateBoards(() => ({ expand: on ? 'fill' : undefined }), paths)} />
        </PRow>
        <div className="flex gap-1.5 px-3 pt-1.5">
          <PButton onClick={() => zoomToBoards([...paths])}>
            <Maximize2 className="size-3.5" /> Zoom to
          </PButton>
        </div>
      </PSection>
    </>
  );
}

/* ------------------------------- note inspector ---------------------------- */

const SIZES: { value: Exclude<NoteSize, number>; label: string }[] = [
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
  { value: 'xl', label: 'XL' },
  { value: 'xxl', label: 'XXL' },
];

function Swatches({ selected, onPick, disabled, ring, colorOf }: { selected?: string; onPick(color: string): void; disabled: boolean; ring?: boolean; colorOf(color: (typeof NOTE_COLORS)[number]): string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          title={color}
          disabled={disabled}
          onClick={() => onPick(color)}
          className={cn('size-[18px] rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]', ring && 'border-[3px] bg-transparent', selected === color && 'outline-2 outline-offset-1 outline-chrome-accent')}
          style={ring ? { borderColor: colorOf(color) } : { background: colorOf(color) }}
        />
      ))}
    </div>
  );
}

function NoteInspector({ id }: { id: string }) {
  const note = useDocument((s) => s.canvas.notes[id]);
  const readOnly = useDocument((s) => s.readOnly);
  if (!note) return null;
  const textual = !note.kind || note.kind === 'sticky' || note.kind === 'title1' || note.kind === 'rect' || note.kind === 'oval';
  const shape = note.kind === 'rect' || note.kind === 'oval';
  const stroked = note.kind === 'title1' || note.kind === 'arrow' || note.kind === 'line' || note.kind === 'pen';
  const sticky = !note.kind || note.kind === 'sticky';
  const colorKey = shape || sticky ? 'fill' : 'color';
  const title = note.kind === 'title1' ? 'Text' : note.kind === 'pen' ? 'Drawing' : note.kind ? note.kind[0]!.toUpperCase() + note.kind.slice(1) : 'Sticky note';
  return (
    <>
    <PSection title={title}>
      <PRow label={shape ? 'Fill' : 'Color'}>
        <Swatches
          selected={note[colorKey]}
          disabled={readOnly}
          colorOf={(color) => (stroked ? NOTE_PALETTE[color].stroke : NOTE_PALETTE[color].sticky)}
          onPick={(color) => updateNote(id, { [colorKey]: note[colorKey] === color ? undefined : color })}
        />
      </PRow>
      {shape ? (
        <PRow label="Stroke">
          <Swatches ring selected={note.color} disabled={readOnly} colorOf={(color) => NOTE_PALETTE[color].stroke} onPick={(color) => updateNote(id, { color: note.color === color ? undefined : color })} />
        </PRow>
      ) : null}
      {note.kind === 'line' || note.kind === 'arrow' ? (['headStart', 'headEnd'] as const).map(key => (
        <PRow key={key} label={key === 'headStart' ? 'Start' : 'End'}>
          <PSelect aria-label={key === 'headStart' ? 'Start arrowhead' : 'End arrowhead'} value={note[key] ?? (key === 'headEnd' && note.kind === 'arrow' ? 'filled' : 'none')}
            disabled={readOnly} options={['none', 'open', 'filled'].map(value => ({ value, label: value }))}
            onChange={value => updateNote(id, { [key]: value })} />
        </PRow>
      )) : null}
      {textual ? (
        <>
          <PRow label="Size">
            <PSegments
              className="flex-1"
              disabled={readOnly}
              value={typeof note.size === 'string' ? note.size : note.size ? null : note.kind === 'title1' ? 'xl' : 's'}
              options={SIZES.map((s) => ({ value: s.value, label: s.label, icon: <span className="text-[12px]">{s.label}</span> }))}
              onChange={(value) => updateNote(id, { size: value })}
            />
          </PRow>
          <PRow label="Style">
            <PIconButton label="Bold" pressed={note.bold ?? note.kind === 'title1'} disabled={readOnly} onClick={() => updateNote(id, { bold: !(note.bold ?? note.kind === 'title1') })}>
              <Bold className="size-3.5" />
            </PIconButton>
            <PIconButton label="Italic" pressed={Boolean(note.italic)} disabled={readOnly} onClick={() => updateNote(id, { italic: note.italic ? undefined : true })}>
              <Italic className="size-3.5" />
            </PIconButton>
          </PRow>
        </>
      ) : null}
      {note.kind === 'link' ? (
        <><PRow label="Title"><PInput aria-label="Link title" value={note.title ?? note.text ?? ''} disabled={readOnly} onCommit={value => updateNote(id, { title: value, text: undefined })} /></PRow>
        <PRow label="URL">
          <PInput aria-label="Link" value={note.href ?? ''} disabled={readOnly} onCommit={(value) => updateNote(id, { href: value.trim() || undefined })} />
        </PRow></>
      ) : null}
    </PSection>
    <NoteSizeSection id={id} note={note} readOnly={readOnly} />
    {note.kind === 'image' ? <NoteImageSection id={id} note={note} readOnly={readOnly} /> : null}
    {shape || note.kind === 'image' || (stroked && note.kind !== 'title1') ? <NoteStyleSection id={id} note={note} readOnly={readOnly} /> : null}
    </>
  );
}

/** Why a field of a canvas object is off, when it is: the file is view only, or the object is locked. */
export const VIEW_ONLY_REASON = 'View only — you can inspect this design but not change it';
export const NOTE_REASONS = {
  position: 'Canvas objects are placed freely on the canvas',
  sizing: 'A canvas object has a fixed size — there is no parent to hug or fill',
  sticky: 'A note grows with its text, then scrolls when out of space',
  title: 'A title is as wide and tall as its text, up to its max width and height',
  link: 'A link card is always this size',
  oval: 'An oval is always round',
  outsideImage: 'A canvas picture shows an uploaded file or a project image, not an outside address.',
} as const;

/**
 * A canvas object's size and place. Its width and height are fixed (no
 * parent to hug or fill), a sticky's height follows its text, a title is
 * as big as its text (up to its max width and height), a link card has one
 * size; lines and drawings have no width or height rows. The position
 * mode is off: canvas objects are placed freely.
 */
function NoteSizeSection({ id, note, readOnly }: { id: string; note: CanvasNote; readOnly: boolean }) {
  const locked = isLockedObject(note) ? LOCKED_REASON : undefined;
  const off = readOnly ? VIEW_ONLY_REASON : locked;
  const rect = noteRect(note);
  const sticky = !note.kind || note.kind === 'sticky';
  const fixedWhy = (axis: 'w' | 'h'): string | undefined =>
    note.kind === 'title1' ? NOTE_REASONS.title : note.kind === 'link' ? NOTE_REASONS.link : sticky && axis === 'h' ? NOTE_REASONS.sticky : undefined;
  const sizeRow = (axis: 'w' | 'h') => {
    const why = fixedWhy(axis);
    return (
      <PRow key={axis} label={axis === 'w' ? 'Width' : 'Height'} title={off ?? why}>
        <PInput
          aria-label={axis === 'w' ? 'width' : 'height'}
          min={1}
          numeric
          unit="px"
          value={why || note[axis] === undefined ? '' : String(Math.round(note[axis]!))}
          placeholder={String(Math.round(rect[axis]))}
          disabled={Boolean(off ?? why)}
          onCommit={(value) => {
            const n = num(value);
            if (Number.isFinite(n) && n >= 1) updateNote(id, { [axis]: Math.round(n) });
          }}
        />
        <span title={off ?? NOTE_REASONS.sizing} className="w-[72px] shrink-0">
          <PSelect aria-label={`${axis === 'w' ? 'width' : 'height'} sizing`} value="fixed" options={SIZING} disabled onChange={() => undefined} />
        </span>
      </PRow>
    );
  };
  const maxRow = (key: 'maxW' | 'maxH', label: string, fallback: string) => (
    <PRow key={key} label={label} title={off}>
      <PInput
        aria-label={label}
        min={1}
        numeric
        unit="px"
        value={note[key] === undefined ? '' : String(note[key])}
        placeholder={fallback}
        disabled={Boolean(off)}
        onCommit={(value) => updateNote(id, { [key]: value && num(value) >= 1 ? Math.round(num(value)) : undefined })}
      />
    </PRow>
  );
  return (
    <PSection title="Size">
      {isPathNote(note) ? null : (['w', 'h'] as const).map(sizeRow)}
      {note.kind === 'title1' ? [maxRow('maxW', 'Max width', '1200'), maxRow('maxH', 'Max height', 'None')] : null}
      <PRow label="Position" title={off ?? NOTE_REASONS.position}>
        <PSelect aria-label="Position" value="absolute" options={POSITIONS} disabled onChange={() => undefined} />
      </PRow>
      <PRow label="Place" title={off}>
        {(['x', 'y'] as const).map((key) => (
          <PInput
            key={key}
            aria-label={key.toUpperCase()}
            prefix={key.toUpperCase()}
            value={String(Math.round(note[key]))}
            disabled={Boolean(off)}
            onCommit={(value) => Number.isFinite(num(value)) && updateNote(id, { [key]: Math.round(num(value)) })}
          />
        ))}
      </PRow>
    </PSection>
  );
}

const OBJECT_FITS: POption[] = ['fill', 'contain', 'cover', 'none', 'scale-down'].map((value) => ({ value, label: value === 'scale-down' ? 'Scale down' : value[0]!.toUpperCase() + value.slice(1) }));

/** An image note's picture: where it comes from (an upload or a project image), how it fits its box and where it sits. */
function NoteImageSection({ id, note, readOnly }: { id: string; note: CanvasNote; readOnly: boolean }) {
  const css = note.css ?? {};
  const off = readOnly ? VIEW_ONLY_REASON : undefined;
  return (
    <PSection title="Image">
      <PRow label="Source" title={off}>
        <PInput
          aria-label="Image source"
          mono
          value={note.src ?? ''}
          placeholder="None"
          disabled={readOnly}
          onCommit={(value) => {
            const next = value.trim();
            if (/^([a-z][\w+.-]*:|\/\/)/i.test(next) && !/^data:image\//i.test(next)) {
              toast.add({ title: NOTE_REASONS.outsideImage });
              return;
            }
            if (next) updateNote(id, { src: next });
          }}
        />
      </PRow>
      <PRow label="Fit" title={off}>
        <PSelect aria-label="Object fit" value={css['object-fit'] ?? 'fill'} options={OBJECT_FITS} disabled={readOnly} onChange={(value) => setNoteCss(id, note, { 'object-fit': value === 'fill' ? null : value })} />
      </PRow>
      <PRow label="Position" title={off}>
        <PInput aria-label="Object position" value={css['object-position'] ?? ''} placeholder="center" disabled={readOnly} onCommit={(value) => setNoteCss(id, note, { 'object-position': value || null })} />
      </PRow>
    </PSection>
  );
}

/** Said when a fill a canvas object cannot take (an image) is typed. */
export const NOTE_FILL_REFUSED = 'A canvas object takes a color or gradient fill. To add an image, drag or paste it onto the canvas.';

/** Writes `key` of a note's css (null: removes it); a value the note does not take changes nothing and says false. */
function setNoteCss(id: string, note: CanvasNote, patch: Record<string, string | null>): boolean {
  const next: Record<string, string> = { ...note.css };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value.trim() === '') delete next[key];
    else if (noteCssValue(key, value) === null) return false;
    else next[key] = value.trim();
  }
  updateNote(id, { css: cleanNoteCss(next) });
  return true;
}

const BORDER_STYLES: POption[] = ['none', 'solid', 'dashed', 'dotted', 'double'].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
const BORDER_POSITIONS: POption[] = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
];

/**
 * The style rows of a shape or image note, written to its `css`: fill,
 * border and where it sits, radius, effects and opacity. A line takes
 * its width, dash and opacity.
 */
function NoteStyleSection({ id, note, readOnly }: { id: string; note: CanvasNote; readOnly: boolean }) {
  const css = note.css ?? {};
  const set = (patch: Record<string, string | null>) => setNoteCss(id, note, patch);
  const line = isPathNote(note);
  const opacity = css.opacity === undefined ? '' : String(Math.round((css.opacity.endsWith('%') ? Number.parseFloat(css.opacity) / 100 : Number(css.opacity)) * 100));
  const opacityRow = (
    <PRow label="Opacity">
      <PInput aria-label="Object opacity" name="Opacity" className="w-[68px] shrink-0" numeric min={0} max={100} unit="%" value={opacity} placeholder="100" disabled={readOnly}
        onCommit={(next) => set({ opacity: !next || num(next) >= 100 ? null : String(num(next) / 100) })} />
    </PRow>
  );
  if (line) {
    return (
      <PSection title="Stroke">
        <PRow label="Width">
          <PInput aria-label="Stroke width" name="Width" min={0} max={100} numeric unit="px" value={note.stroke === undefined ? '' : String(note.stroke)} placeholder={String(noteStroke(note).width)} disabled={readOnly}
            onCommit={(next) => updateNote(id, { stroke: next ? num(next) : undefined })} />
        </PRow>
        <PRow label="Dash">
          <PSelect aria-label="Dash" value={note.dash ?? 'solid'} disabled={readOnly} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]}
            onChange={(value) => updateNote(id, { dash: value === 'solid' ? undefined : (value as 'dashed' | 'dotted') })} />
        </PRow>
        {opacityRow}
      </PSection>
    );
  }
  const oval = note.kind === 'oval';
  const image = note.kind === 'image';
  const position = css['border-position'] ?? 'inside';
  // An image has no border until one is given; a shape draws its palette stroke.
  const drawn = image ? Boolean(css['border-width']) : !hasCssBorder(css);
  return (
    <>
    <PSection title="Appearance">
      <PRow label="Fill">
        <PInput aria-label="Object fill" mono value={css.background ?? css['background-color'] ?? ''} placeholder={note.fill ? shapeFill(note) : 'None'} disabled={readOnly}
          onCommit={(next) => {
            if (/url\(/i.test(next)) {
              toast.add({ title: NOTE_FILL_REFUSED });
              return;
            }
            const key = /gradient\(/i.test(next) ? 'background' : 'background-color';
            set({ background: null, 'background-color': null, ...(next ? { [key]: next } : {}) });
          }} />
      </PRow>
      <PRow label="Border">
        <PInput aria-label="Border width" name="Border width" className="w-[60px] shrink-0" min={0} unit="px" value={withoutUnit(css['border-width'])} placeholder={image ? '0' : hasCssBorder(css) ? '' : '3'} disabled={readOnly}
          onCommit={(next) => set({ 'border-width': next || null, ...(next && !css['border-style'] ? { 'border-style': 'solid' } : {}) })} />
        <PSelect aria-label="Border style" className="w-[84px] shrink-0" value={css['border-style'] ?? (drawn ? 'solid' : 'none')} options={BORDER_STYLES} disabled={readOnly} onChange={(value) => set({ 'border-style': value })} />
        <PInput aria-label="Border color" mono value={css['border-color'] ?? ''} placeholder={image || hasCssBorder(css) ? 'currentcolor' : 'Palette'} disabled={readOnly} onCommit={(next) => set({ 'border-color': next || null })} />
      </PRow>
      <PRow label="Alignment">
        <PSelect aria-label="Border alignment" value={position} options={BORDER_POSITIONS} disabled={readOnly} onChange={(value) => set({ 'border-position': value === 'inside' ? null : value })} />
      </PRow>
      <PRow label="Radius">
        {oval ? (
          <span className="text-[12px] text-chrome-muted" data-reason="radius">{NOTE_REASONS.oval}</span>
        ) : (
          <PInput aria-label="Object radius" name="Radius" min={0} max={400} unit="px" value={withoutUnit(css['border-radius'])} placeholder={image ? '0' : String(NOTE_RECT_RADIUS)} disabled={readOnly}
            onCommit={(next) => {
              set({ 'border-radius': next || null });
              if (note.kind === 'rect') rememberRadius(next || `${NOTE_RECT_RADIUS}px`);
            }} />
        )}
      </PRow>
      {opacityRow}
    </PSection>
    <PSection title="Effects">
      <PRow label="Shadow">
        <PInput aria-label="Object shadow" value={css['box-shadow'] ?? ''} placeholder="None" disabled={readOnly} onCommit={(next) => set({ 'box-shadow': next || null })} />
      </PRow>
      <PRow label="Filter">
        <PInput aria-label="Object filter" value={css.filter ?? ''} placeholder="None" disabled={readOnly} onCommit={(next) => set({ filter: next || null })} />
      </PRow>
      <PRow label="Backdrop">
        <PInput aria-label="Backdrop blur" name="Backdrop blur" min={0} numeric unit="px" value={/^blur\((\d*\.?\d+)px\)$/.exec(css['backdrop-filter'] ?? '')?.[1] ?? ''} placeholder="0" disabled={readOnly}
          onCommit={(next) => set({ 'backdrop-filter': next && num(next) > 0 ? `blur(${num(next)}px)` : null })} />
      </PRow>
    </PSection>
    </>
  );
}

/* -------------------------------- canvas info ------------------------------ */

function CanvasInspector() {
  const canvas = useDocument((s) => s.canvas);
  const readOnly = useDocument((s) => s.readOnly);
  const launch = canvas.launch?.view === 'focused' ? canvas.launch.file : '';
  return (
    <>
      <PSection title="Design">
        <PRow label="Opens">
          <PSelect
            aria-label="What opens first"
            value={launch}
            options={[{ value: '', label: 'The canvas' }, ...canvas.order.map((path) => ({ value: path, label: canvas.boards[path]?.title || path }))]}
            disabled={readOnly}
            onChange={(value) => useDocument.getState().updateCanvas((c) => ({ ...c, launch: value ? { view: 'focused', file: value } : { view: 'canvas' } }))}
          />
        </PRow>
        <PNote className="py-1">
          {canvas.order.length} artboards · {Object.keys(canvas.notes).length} notes{canvas.pages.length ? ` · ${canvas.pages.length} pages` : ''}
        </PNote>
      </PSection>
      <PSection>
        <PNote>Click an artboard to select an element in it, or its name to select the whole artboard. Double-click text to edit it. Drag on empty canvas to select several.</PNote>
      </PSection>
    </>
  );
}

const MIXED_ROW_LABELS: Record<PaintRole, string> = { text: 'Text color', fill: 'Fill', stroke: 'Stroke' };

/**
 * A count that moves on once these inputs have stayed the same for a
 * moment: merged rows read the artboards again then, not on every render.
 */
function useSettledTick(inputs: readonly unknown[]): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setTick((count) => count + 1), READ_SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, inputs);
  return tick;
}

/**
 * A selection across files, or artboards with notes: the rows every
 * member has, showing their one value or `Mixed`; a change goes to each
 * member (one undo step). Notes join the Fill row when they are shapes;
 * artboards have no color rows. Position is off with canvas objects or
 * pieces in the selection, and for locked elements.
 */
function MixedInspector({ selection }: { selection: MixedSelection | ObjectsSelection }) {
  const readOnly = useDocument((s) => s.readOnly);
  const canvas = useDocument((s) => s.canvas);
  // Re-read once the artboards settle after a change or a re-render.
  const boards = useDocument((s) => s.boards);
  const layoutTick = useView((s) => s.layoutTick);
  const settled = useSettledTick([boards, layoutTick]);
  const elements = selection.kind === 'mixed' ? selection.elements : [];
  const across = { elements, notes: selection.notes };
  const counts = selectionCounts(selection);
  const notes = selection.notes.flatMap((id) => (canvas.notes[id] ? [canvas.notes[id]] : []));
  const pieces = elements.filter((group) => canvas.boards[group.board]?.frameless).length;
  const rows = useMemo(
    () =>
      mixedRoles(mixedElementKinds(across), notes, selection.boards.length).map((role) => ({
        role,
        value: mergedValue([...mixedPaintValues(across, role), ...(role === 'fill' ? noteFillValues(selection.notes) : [])]),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, canvas.notes, settled],
  );
  const position = useMemo(
    () => (elements.length ? { value: mergedValue(mixedComputed(elements, 'position')), locked: anyElementLocked(elements) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, settled],
  );
  const positionWhy = positionBlocked({ objects: counts.objects, pieces }) ? POSITION_ACROSS : position?.locked ? LOCKED_REASON : undefined;
  const parts = counts.elements ? [`${counts.elements} ${counts.elements === 1 ? 'element' : 'elements'}`] : [];
  if (counts.elementBoards > 1) parts.push(`on ${counts.elementBoards} artboards`);
  if (selection.boards.length) parts.push(`${parts.length ? 'and ' : ''}${selection.boards.length} ${selection.boards.length === 1 ? 'artboard' : 'artboards'}`);
  if (selection.notes.length) parts.push(`${parts.length ? 'and ' : ''}${selection.notes.length} ${selection.notes.length === 1 ? 'note' : 'notes'}`);
  return (
    <PSection title={`${counts.elements + counts.objects} selected`}>
      <PNote className="py-1">{parts.join(' ')}</PNote>
      {position ? (
        <PRow label="Position" title={positionWhy ?? (position.value === MIXED ? MIXED_ACROSS : undefined)}>
          <PSelect
            aria-label="Position"
            value={position.value === MIXED ? '' : position.value || 'static'}
            placeholder={MIXED}
            options={POSITIONS}
            disabled={readOnly || Boolean(positionWhy)}
            onChange={(next) => next && styleMixed(elements, { position: next === 'static' ? null : next })}
          />
        </PRow>
      ) : null}
      {rows.map(({ role, value }) => (
        <PRow key={role} label={MIXED_ROW_LABELS[role]} title={value === MIXED ? MIXED_ACROSS : undefined}>
          <PColor
            aria-label={MIXED_ROW_LABELS[role]}
            value=""
            placeholder={value === MIXED ? MIXED : value || undefined}
            disabled={readOnly}
            onCommit={(next) => paintMixed(across, role, next || null)}
          />
        </PRow>
      ))}
    </PSection>
  );
}

function PropertiesBody() {
  const selection = useView((s) => s.selection);
  if (selection.kind === 'elements') return <ElementInspector key={selection.board} board={selection.board} />;
  if (selection.kind === 'mixed') return <MixedInspector selection={selection} />;
  if (selection.kind === 'objects') {
    const route = inspectorRoute(selection);
    if (route === 'board') return <BoardInspector path={selection.boards[0]!} />;
    if (route === 'note') return <NoteInspector id={selection.notes[0]!} />;
    if (route === 'boards') return <BoardsInspector paths={selection.boards} />;
    return <MixedInspector selection={selection} />;
  }
  return <CanvasInspector />;
}

/* ----------------------------------- code ---------------------------------- */

const INHERITED = ['font', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform'];
const looksLikeColor = (value: string) => /^(#|rgb|hsl|oklch|oklab|lab\(|lch\(|color\()/i.test(value.trim());

/** The editable text of an element: its declarations, then `@attr: value` lines. */
function codeOf(element: HtmlElement): { css: string; attrs: Map<string, string | null>; text: string } {
  const css = attributeValue(element, 'style') ?? '';
  const lines = parseStyle(css).map((d) => `${d.property}: ${d.value}${d.important ? ' !important' : ''};`);
  const attrs = new Map<string, string | null>();
  for (const attr of element.attrs) {
    const name = attr.name.toLowerCase();
    // The lock marker is not edited here (its own command sets and clears it).
    if (name === 'style' || name === LOCK_ATTRIBUTE || name.startsWith('data-dc') || name.startsWith('sc-')) continue;
    attrs.set(attr.name, attr.value);
  }
  const attrLines = [...attrs].map(([name, value]) => (value === null ? `@${name}` : `@${name}: ${value}`));
  return { css, attrs, text: [lines.join('\n'), attrLines.join('\n')].filter(Boolean).join('\n\n') };
}

/** Parses the Code tab's text back into a style string and attributes. */
function parseCode(text: string): { css: string; attrs: Map<string, string | null> } {
  const attrs = new Map<string, string | null>();
  const css: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      const colon = trimmed.indexOf(':');
      const name = (colon < 0 ? trimmed.slice(1) : trimmed.slice(1, colon)).trim();
      if (/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(name)) attrs.set(name, colon < 0 ? null : trimmed.slice(colon + 1).trim());
    } else css.push(line);
  }
  return { css: serializeStyle(parseStyle(css.join('\n'))), attrs };
}

function CodeBody() {
  const selection = useView((s) => s.selection);
  const board = selection.kind === 'elements' ? selection.board : '';
  const ctx = useElementContext(board);
  const readOnly = useDocument((s) => s.readOnly);
  const code = useMemo(() => (ctx ? codeOf(ctx.element) : null), [ctx?.element]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(code?.text ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(code?.text ?? '');
  }, [code, focused]);

  if (selection.kind !== 'elements' || !ctx || !code) {
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <div className="text-[13px] font-medium text-chrome-fg">Nothing selected</div>
        <div className="mt-1 text-[12px] leading-[1.45] text-chrome-muted">Click any element in the design to edit its code here.</div>
      </div>
    );
  }
  const target = { tid: ctx.model.tidOf.get(ctx.element)!, path: elementPath(ctx.model, ctx.element) };
  const editable = !readOnly && !ctx.dynamic && !ctx.many;

  const commit = () => {
    if (!editable || draft === code.text) return;
    const next = parseCode(draft);
    if (next.css !== serializeStyle(parseStyle(code.css))) edit(ctx.board, { kind: 'attr', target, name: 'style', value: next.css || null });
    for (const [name, value] of next.attrs) if (!code.attrs.has(name) || code.attrs.get(name) !== value) edit(ctx.board, { kind: 'attr', target, name, value: value ?? '' });
    for (const name of code.attrs.keys()) if (!next.attrs.has(name)) edit(ctx.board, { kind: 'attr', target, name, value: null });
  };

  // What the element inherits from ancestors' inline styles.
  const seen = new Set(Object.keys(ctx.inline));
  const groups: { element: HtmlElement; rows: [string, string][] }[] = [];
  for (let parent = ctx.element.parent; parent; parent = parent.parent) {
    const map = styleMap(attributeValue(parent, 'style') ?? '');
    const rows: [string, string][] = [];
    for (const name of INHERITED) {
      const value = map[name];
      if (!value || seen.has(name) || /^(inherit|unset|initial|revert)$/.test(value) || value.includes('{{')) continue;
      seen.add(name);
      rows.push([name, value]);
    }
    if (rows.length) groups.push({ element: parent, rows });
  }
  const selectElement = (element: HtmlElement) =>
    useView.getState().select({ kind: 'elements', board: ctx.board, items: [{ tid: ctx.model.tidOf.get(element)!, path: elementPath(ctx.model, element), instance: 0 }] });

  const { name } = describeElement(ctx.element);
  return (
    <div className="flex flex-col">
      <div className="truncate px-3.5 pt-2.5 font-mono text-[11px] text-chrome-muted">
        &lt;{ctx.element.tag}&gt;
        <span className="ml-2 font-sans">
          {name} {detailOf(ctx.element)}
        </span>
      </div>
      <textarea
        aria-label="Inline CSS and attributes"
        value={draft}
        readOnly={!editable}
        spellCheck={false}
        placeholder={'Nothing set on this element yet.\nType  color: red;  to style it.'}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (isComposingKey(event.nativeEvent)) return;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            setDraft(code.text);
            event.currentTarget.blur();
          }
        }}
        rows={Math.max(4, draft.split('\n').length + 1)}
        className="w-full resize-none bg-transparent px-3.5 py-3 font-mono text-[11.5px] leading-[1.55] text-chrome-fg outline-none placeholder:whitespace-pre placeholder:text-chrome-muted"
      />
      {ctx.dynamic ? <PNote className="pt-0">This element’s style comes from code. Change it in Tweaks, or ask the agent.</PNote> : null}
      {groups.map((group) => (
        <div key={ctx.model.tidOf.get(group.element)} className="border-t border-chrome-sep px-3.5 pb-3 pt-2.5 text-[12px]">
          <div className="mb-1 flex items-center gap-1.5 text-chrome-muted">
            From
            <button type="button" onClick={() => selectElement(group.element)} className="rounded-[4px] px-1 font-mono text-[11.5px] text-chrome-secondary hover:bg-chrome-hover hover:text-chrome-fg">
              {selectorOf(group.element)}
            </button>
          </div>
          {group.rows.map(([prop, value]) => (
            <div key={prop} className="group flex h-6 items-center gap-1.5 rounded-[6px] pl-2 font-mono text-[11.5px] hover:bg-chrome-hover">
              <span className="w-[100px] shrink-0 truncate text-chrome-muted">{prop}</span>
              {looksLikeColor(value) ? <span className="size-3 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]" style={{ background: value }} /> : null}
              <span className="min-w-0 flex-1 truncate text-chrome-secondary" title={value}>
                {value}
              </span>
              {editable ? (
                <Tip label="Set on this element" side="left">
                  <PIconButton label="Set on this element" className="size-5 opacity-0 group-hover:opacity-100" onClick={() => ctx.set({ [prop]: value })}>
                    <Plus className="size-3.5" />
                  </PIconButton>
                </Tip>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- tweaks --------------------------------- */

/** The artboard Tweaks applies to. */
function useTweakBoard(): string | null {
  const selection = useView((s) => s.selection);
  const focused = useView((s) => s.focused);
  if (focused) return focused;
  if (selection.kind === 'elements') return selection.board;
  if (selection.kind === 'objects' && selection.boards.length === 1) return selection.boards[0]!;
  return null;
}

function TweakControl({ board, name, spec, value }: { board: string; name: string; spec: PropSpec; value: unknown }) {
  const set = (next: unknown) => useView.getState().setOverride(board, name, next);
  switch (spec.editor) {
    case 'boolean':
      return <Switch label={name} checked={Boolean(value)} onChange={set} />;
    case 'color':
      return <PColor aria-label={name} value={typeof value === 'string' ? value : ''} onCommit={set} />;
    case 'enum':
      return (
        <PSelect
          aria-label={name}
          value={value === undefined ? null : String(value)}
          options={(spec.options ?? []).map((o) => ({ value: String(o), label: String(o) }))}
          onChange={(picked) => set((spec.options ?? []).find((o) => String(o) === picked) ?? picked)}
        />
      );
    case 'range':
      return (
        <>
          <PInput
            aria-label={`${name} value`}
            name={name}
            className="w-[68px] shrink-0"
            numeric
            min={spec.min ?? 0}
            max={spec.max ?? 100}
            step={spec.step ?? 1}
            unit={spec.unit}
            value={value === undefined || value === null ? '' : String(value)}
            onCommit={(next) => {
              const n = num(next);
              if (Number.isFinite(n)) set(n);
            }}
          />
          {/* A range with no step drags in a thousand steps; its keys still move by the field's step. */}
          <SliderInput aria-label={name} look={PANEL_SLIDER} unit={spec.unit} min={spec.min ?? 0} max={spec.max ?? 100}
            step={spec.step ?? ((spec.max ?? 100) - (spec.min ?? 0)) / 1000} {...(spec.step === undefined ? { keyStep: 1 } : {})}
            value={Number(value ?? spec.min ?? 0)} onChange={set} />
        </>
      );
    case 'int':
    case 'float':
      return (
        <PInput
          aria-label={name}
          value={typeof value === 'number' ? String(value) : ''}
          unit={spec.unit}
          onCommit={(next) => {
            const n = num(next);
            if (!Number.isFinite(n)) return;
            const clamped = clamp(n, spec.min ?? -Infinity, spec.max ?? Infinity);
            set(spec.editor === 'int' ? Math.round(clamped) : clamped);
          }}
        />
      );
    default:
      return <PInput aria-label={name} value={value === undefined || value === null ? '' : String(value)} onCommit={set} />;
  }
}

function TweaksBody() {
  const board = useTweakBoard();
  const source = useDocument((s) => (board ? (s.boards[board]?.source ?? null) : null));
  const readOnly = useDocument((s) => s.readOnly);
  const overrides = useView((s) => (board ? s.overrides[board] : undefined));
  const doc = useMemo(() => (source ? parseDcDocument(source) : null), [source]);

  const empty = (text: string) => <div className="px-6 py-10 text-center text-[11.5px] leading-[1.5] text-chrome-muted">{text}</div>;
  if (!board) return empty('Select an artboard to see its tweakable controls.');
  if (!doc) return null;
  if (doc.propsError) return <PNote className="text-danger">{doc.propsError}</PNote>;
  const entries = tweakEntries(doc.props);
  if (!entries.length) return empty('This design has no tweakable controls yet. Ask the agent to expose colors, copy or layout options as tweaks.');
  const groups = new Map<string, [string, PropSpec][]>();
  for (const entry of entries) {
    const key = entry[1].section ?? '';
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const changed = Boolean(overrides && Object.keys(overrides).length > 0);
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        {[...groups].map(([section, list]) => (
          <PSection key={section || '_'} title={section || undefined}>
            {list.map(([name, spec]) => (
              <PRow key={name} label={spec.label ?? name} title={name}>
                <TweakControl board={board} name={name} spec={spec} value={overrides && name in overrides ? overrides[name] : spec.default} />
              </PRow>
            ))}
          </PSection>
        ))}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-1.5 border-t border-chrome-sep bg-chrome px-2 py-3">
        <PButton disabled={!changed} onClick={() => useView.getState().clearOverrides(board)}>
          <RotateCcw className="size-3.5" /> Reset
        </PButton>
        {readOnly ? null : (
          <PButton
            primary
            disabled={!changed}
            onClick={() => {
              if (edit(board, { kind: 'props', values: overrides! })) useView.getState().clearOverrides(board);
            }}
          >
            <Save className="size-3.5" /> Save as defaults
          </PButton>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------- panel --------------------------------- */

const WIDTH_KEY = 'mc-side/width';
const OUTLINE_KEY = 'mc-side/outline';
const maxWidth = () => Math.min(560, window.innerWidth - 120);

const CUSTOM_WIDTH_KEY = 'mc-side/custom-width';
const DEFAULT_WIDTH = 336;
const MIN_WIDTH = 285;
/** Pointer travel before a press on the grip resizes. */
const RESIZE_AFTER = 3;
/** Pointer travel after which a press is no click. */
const CLICK_SLOP = 8;
/** A click waits this long, so a double click does nothing. */
const CLICK_DELAY = 500;

/**
 * The panel's resize grip. Dragging sets the width (a width that is no
 * preset is kept as the custom one); a click or Enter steps through the
 * presets (see `nextPanelWidth`).
 */
function PanelGrip({ width, onWidth }: { width: number; onWidth(width: number): void }) {
  const press = useRef<{ x: number; y: number; start: number; resizing: boolean; click: boolean; last: number } | null>(null);
  const pending = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pending.current), []);
  const widths = (): PanelWidths => ({ default: DEFAULT_WIDTH, min: MIN_WIDTH, max: maxWidth(), custom: stored(CUSTOM_WIDTH_KEY, 0) || null });
  const step = (): void => {
    const next = nextPanelWidth(width, widths());
    onWidth(next);
    store(WIDTH_KEY, next);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={Math.round(maxWidth())}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { x: event.clientX, y: event.clientY, start: width, resizing: false, click: true, last: width };
      }}
      onPointerMove={(event) => {
        const current = press.current;
        if (!current) return;
        const dx = event.clientX - current.x;
        if (Math.hypot(dx, event.clientY - current.y) > CLICK_SLOP) current.click = false;
        if (!current.resizing && Math.abs(dx) <= RESIZE_AFTER) return;
        current.resizing = true;
        current.click = false;
        current.last = clamp(current.start - dx, MIN_WIDTH, maxWidth());
        onWidth(current.last);
      }}
      onPointerUp={(event) => {
        const current = press.current;
        if (!current) return;
        press.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (current.resizing) {
          store(WIDTH_KEY, current.last);
          if (!isFixedPreset(current.last, { default: DEFAULT_WIDTH, min: MIN_WIDTH, max: maxWidth() })) store(CUSTOM_WIDTH_KEY, current.last);
          return;
        }
        if (!current.click) return;
        window.clearTimeout(pending.current);
        pending.current = window.setTimeout(step, CLICK_DELAY);
      }}
      onDoubleClick={() => window.clearTimeout(pending.current)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        step();
      }}
      className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize outline-none focus-visible:bg-chrome-accent/40"
    />
  );
}

/** The layers list with its bottom resize handle. */
function OutlinePane() {
  const [height, setHeight] = useState(() => clamp(stored(OUTLINE_KEY, 168), 72, 480));
  const [start, setStart] = useState(height);
  const drag = useDragResize(
    ({ dy }) => setHeight(clamp(start + dy, 72, 480)),
    () => setStart((h) => (store(OUTLINE_KEY, height), height ?? h)),
  );
  return (
    <div className="relative shrink-0 border-b border-chrome-sep" style={{ height }}>
      <Outline />
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize layers list"
        {...drag}
        onPointerDown={(event) => {
          setStart(height);
          drag.onPointerDown(event);
        }}
        className="absolute inset-x-0 -bottom-1 z-10 h-2 cursor-row-resize"
      />
    </div>
  );
}

const TAB = 'h-6 rounded-[6px] px-2 text-[13px] font-control text-chrome-muted outline-none transition-colors hover:text-chrome-fg data-[active]:bg-chrome-hover data-[active]:text-chrome-fg focus-visible:outline-2 focus-visible:outline-chrome-accent';

export function PropertiesPanel() {
  const panel = useView((s) => s.panel);
  const setPanel = useView((s) => s.setPanel);
  const togglePanel = useView((s) => s.togglePanel);
  const [width, setWidth] = useState(() => clamp(stored(WIDTH_KEY, DEFAULT_WIDTH), MIN_WIDTH, maxWidth()));
  // A narrower window narrows the panel with it.
  useEffect(() => {
    const fit = () => setWidth((current) => clamp(current, MIN_WIDTH, maxWidth()));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <aside data-properties-panel className="relative flex h-full shrink-0 flex-col border-l border-chrome-sep bg-chrome text-chrome-fg" style={{ width }}>
      <PanelGrip width={width} onWidth={setWidth} />
      <BaseTabs.Root value={panel} onValueChange={(value) => setPanel(value as typeof panel)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-[6px] px-[6px] py-2">
          <BaseTabs.List className="flex min-w-0 flex-1 items-center gap-0.5">
            <BaseTabs.Tab value="properties" className={TAB}>
              Properties
            </BaseTabs.Tab>
            <BaseTabs.Tab value="code" className={TAB}>
              Code
            </BaseTabs.Tab>
            <BaseTabs.Tab value="tweaks" className={TAB}>
              Tweaks
            </BaseTabs.Tab>
            <BaseTabs.Tab value="theme" className={TAB}>
              Theme
            </BaseTabs.Tab>
          </BaseTabs.List>
          <Tip label="Close" shortcut={`${MOD}\\`}>
            <button type="button" aria-label="Close panel" onClick={togglePanel} className="flex size-5 items-center justify-center rounded-[5px] text-chrome-secondary hover:bg-chrome-hover hover:text-chrome-fg">
              <X className="size-3.5" />
            </button>
          </Tip>
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-t border-chrome-sep">
          {panel !== 'tweaks' && panel !== 'theme' ? <OutlinePane /> : null}
          <BaseTabs.Panel value="properties" className="min-h-0 flex-1 overflow-y-auto outline-none">
            <PropertiesBody />
          </BaseTabs.Panel>
          <BaseTabs.Panel value="code" className="min-h-0 flex-1 overflow-y-auto outline-none">
            <CodeBody />
          </BaseTabs.Panel>
          <BaseTabs.Panel value="tweaks" className="min-h-0 flex-1 overflow-y-auto outline-none">
            <TweaksBody />
          </BaseTabs.Panel>
          <BaseTabs.Panel value="theme" className="min-h-0 flex-1 overflow-y-auto outline-none">
            <ThemePanel />
          </BaseTabs.Panel>
        </div>
      </BaseTabs.Root>
    </aside>
  );
}

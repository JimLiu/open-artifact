/**
 * The floating strip above a selected element, after the Design
 * selection quick actions:
 *
 * - boxes: background color, border | corner radius, spacing | ask, more;
 * - text: typography, color, bold, italic, underline, link | alignment |
 *   edit text, ask, more.
 *
 * Each popup edits the inline style of every selected element. The strip
 * hides while text is being edited and while the properties panel is open.
 */

import { Popover } from '@base-ui/react/popover';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Ban,
  Bold,
  ChevronDown,
  Component,
  Crop,
  Image as ImageIcon,
  Unlink,
  EllipsisVertical,
  Italic,
  Link,
  List,
  ListOrdered,
  Lock,
  LockOpen,
  PencilLine,
  Trash2,
  Underline,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { attributeValue, elementKind, hasDynamicStyle, isTextEditable, resolveElement, styleMap, type HtmlElement, type StylePatch, type TextFormat } from '@open-artifact/dc';
import { cn, isComposingKey } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { boardApi } from '../services/frames.ts';
import { templateOf } from '../services/agent.ts';
import { useCoarsePointer } from '../services/pointer.ts';
import { attributeSelection, deleteSelection, detachSelection, edit, detachSelectionRefusal, editSelectedComponent, selectedComponentPath, startTextEdit, styleSelection } from '../services/commands.ts';
import { KEEP_TEXT_EDIT, applyEditedTextLink, cancelEditedTextLink, formatEditedText } from '../services/text-edit.ts';
import { cancelScale, commitScale, setScaleFactor, useScale } from '../services/scale.ts';
import { parseScaleInput } from '../lib/scale.ts';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, MOD, Tip, TipGroup } from '@open-artifact/editor-kit/react';
import { toggleSelectionLock, useLockedWhy, useSelectionLock } from '../services/locks.ts';
import { PColor, PIconButton, PInput, PSegments, isTransparent, roundPx, toHex, withoutUnit } from './fields.tsx';
import { BorderAlignButton } from './BorderAlign.tsx';
import { alignedLookPatch, readAlignment, SIDES_NEED_INSIDE } from '../lib/border-align.ts';
import { fillColorPatch } from '../lib/paint.ts';
import { loneShapeOf } from '../lib/lone-shape.ts';
import { layerPaint, paintSelection } from '../services/paint.ts';
import { addressCardKeys } from './address-card.ts';

/** Screen box of the selection the bar sits on. */
export interface SelectionBarBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Strip height plus gap: the strip flips below the element when there is no room above. */
const BAR_SPACE = 44;

const ICON = { className: 'size-4', strokeWidth: 1.75 } as const;
const SMALL = { className: 'size-3.5', strokeWidth: 1.75 } as const;

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];
const SIDE_INITIAL: Record<Side, string> = { top: 'T', right: 'R', bottom: 'B', left: 'L' };

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
type Corner = (typeof CORNERS)[number];
const CORNER_INITIAL: Record<Corner, string> = { 'top-left': 'TL', 'top-right': 'TR', 'bottom-left': 'BL', 'bottom-right': 'BR' };

type BorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** What the strip reads and writes for the selection. */
interface StripContext {
  element: HtmlElement;
  inline: Record<string, string>;
  computed: Record<string, string>;
  locked: boolean;
  set(patch: StylePatch): void;
}

/** `a b c d` shorthand → four sides (top, right, bottom, left). */
function expandSides(value: string | undefined): [string, string, string, string] | null {
  if (!value?.trim()) return null;
  const [a, b = a, c = a, d = b] = value.trim().split(/\s+/) as [string, string?, string?, string?];
  return [a, b!, c!, d!];
}

/** Splits a `border` shorthand into width, style and color. */
function parseBorder(value: string | undefined): { width?: string; style?: string; color?: string } {
  const out: { width?: string; style?: string; color?: string } = {};
  if (!value?.trim()) return out;
  const rest: string[] = [];
  for (const token of value.trim().split(/\s+(?![^(]*\))/)) {
    if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(token)) out.style = token;
    else if (/^(\d*\.?\d+[a-z%]*|thin|medium|thick)$/i.test(token)) out.width = token;
    else rest.push(token);
  }
  if (rest.length) out.color = rest.join(' ');
  return out;
}

/** A length in the inline style written as a bare number, for a field with a unit. */
const fieldValue = (value: string | undefined) => withoutUnit(value);

/* -------------------------------------------------------------------------- */
/* Strip primitives                                                            */
/* -------------------------------------------------------------------------- */

/** A ghost strip button with a tooltip above. */
function StripButton({ tip, shortcut, className, ...props }: Parameters<typeof ChromeButton>[0] & { tip: string; shortcut?: string }) {
  return (
    <Tip label={tip} shortcut={shortcut} side="top">
      <ChromeButton square aria-label={props['aria-label'] ?? tip} className={className} {...props} />
    </Tip>
  );
}

/** A group of strip controls. */
function Group({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-0.5">{children}</span>;
}

/** The color square shown in a color trigger. */
function Swatch({ color }: { color: string | undefined }) {
  const empty = !color || isTransparent(color);
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-4 shrink-0 rounded-[4px] border border-chrome-ring-strong', empty && 'border-dashed')}
      style={empty ? undefined : { background: color }}
    />
  );
}

/** A strip button that opens a popup. */
function StripPopup({
  tip,
  trigger,
  disabled,
  width = 'w-[200px]',
  wide,
  pressed,
  address,
  children,
}: {
  tip: string;
  trigger: ReactNode;
  disabled?: boolean;
  width?: string;
  /** The trigger holds text (not a single icon). */
  wide?: boolean;
  /** Shown as on (a link that is set). */
  pressed?: boolean;
  /** An address card: its keys (see `addressCardKeys`), given the saved address. */
  address?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cardKeys = address === undefined ? undefined : addressCardKeys({ saved: address, close: () => setOpen(false), guardDelete: true });
  const button = (
    <ChromeButton square={!wide} aria-label={tip} pressed={pressed} disabled={disabled} className={cn(wide && 'px-2', open && 'bg-chrome-hover')} />
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label={tip} side="top">
        <Popover.Trigger render={button as ReactElement<Record<string, unknown>>}>{trigger}</Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} className="z-[1000]">
          <Popover.Popup
            aria-label={tip}
            {...{ [KEEP_TEXT_EDIT]: '' }}
            onKeyDown={cardKeys}
            className={cn(
              'flex flex-col gap-1.5 rounded-[12px] bg-chrome p-2 text-[13px] font-control text-chrome-fg shadow-chrome-popup outline-none transition-[opacity,transform] duration-100 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
              width,
            )}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The muted title above a popup section. */
function Hint({ children }: { children: ReactNode }) {
  return <div className="select-none px-0.5 pt-0.5 text-[12px] text-chrome-muted">{children}</div>;
}

/** The "edit each side / corner" toggle in a popup. */
function SplitToggle({ split, label, onToggle, disabled, glyph = 'borderSides' }: { split: boolean; label: string; onToggle(): void; disabled?: boolean; glyph?: keyof typeof GLYPHS }) {
  return (
    <Tip label={label} side="top">
      <PIconButton label={label} pressed={split} disabled={disabled} onClick={onToggle}>
        <Glyph name={glyph} className="size-3.5" />
      </PIconButton>
    </Tip>
  );
}

/** The strip's own 16px stroke glyphs (Design's property icons): path and stroke width. */
const GLYPHS = {
  borderWeight: [['M3.2 3H12.8', 1], ['M3.2 8H12.8', 1.5], ['M3.2 13H12.8', 2]],
  borderSides: [['M5.327 2.655H10.673M5.327 13.345H10.673M2.655 5.328V10.673M13.345 5.328V10.673', 1]],
  cornerCurve: [['M3 14V9C3 5.686 5.686 3 9 3H14', 1]],
  borderCorners: [
    [
      'M2.739 5.826V4.739C2.739 3.634 3.634 2.739 4.739 2.739H5.826M10.174 2.739H11.261C12.366 2.739 13.261 3.634 13.261 4.739V5.826M13.261 10.174V11.261C13.261 12.366 12.366 13.261 11.261 13.261H10.174M5.826 13.261H4.739C3.634 13.261 2.739 12.366 2.739 11.261V10.174',
      1,
    ],
  ],
  spacing: [
    ['M2 4V3C2 2.448 2.448 2 3 2H4M12 2H13C13.552 2 14 2.448 14 3V4M14 12V13C14 13.552 13.552 14 13 14H12M2 12V13C2 13.552 2.448 14 3 14H4M7 2H9M7 14H9M2 7V9M14 7V9', 1],
    ['M6 5.6H10C10.221 5.6 10.4 5.779 10.4 6V10C10.4 10.221 10.221 10.4 10 10.4H6C5.779 10.4 5.6 10.221 5.6 10V6C5.6 5.779 5.779 5.6 6 5.6Z', 1],
  ],
  strokeSolid: [['M2 8H14', 1.5]],
  strokeDashed: [['M1.5 8H4.5M6.5 8H9.5M11.5 8H14.5', 1.5]],
  strokeDotted: [['M2 8H2.01M5 8H5.01M8 8H8.01M11 8H11.01M14 8H14.01', 1.5]],
} satisfies Record<string, [string, number][]>;

function Glyph({ name, className = 'size-4' }: { name: keyof typeof GLYPHS; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={cn('shrink-0', className)}>
      {GLYPHS[name].map(([d, width]) => (
        <path key={d} d={d} stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Box panels                                                                  */
/* -------------------------------------------------------------------------- */

/** A "no color" swatch and the color field. */
function ColorPanel({ value, rendered, label, onCommit, disabled }: { value: string; rendered?: string; label: string; onCommit(value: string | null): void; disabled?: boolean }) {
  const none = value === 'transparent' || value === 'none';
  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="None"
          title="None"
          aria-pressed={none}
          disabled={disabled}
          onClick={() => onCommit('transparent')}
          className={cn(
            'relative flex size-6 items-center justify-center rounded-[6px] border border-dashed border-chrome-ring-strong text-chrome-muted hover:text-chrome-fg',
            none && 'outline-2 outline-offset-1 outline-chrome-accent',
          )}
        >
          <Ban {...SMALL} />
        </button>
      </div>
      <PColor aria-label={label} value={none ? '' : value} placeholder={rendered && !isTransparent(rendered) ? rendered : undefined} disabled={disabled} onCommit={(next) => onCommit(next || null)} />
    </>
  );
}

/** Background color. */
function BackgroundPopup({ ctx }: { ctx: StripContext }) {
  const written = ctx.inline['background-color'] ?? (ctx.inline.background && !/url\(|gradient\(/.test(ctx.inline.background) ? ctx.inline.background : '');
  const rendered = ctx.computed['background-color'];
  const shown = written || rendered;
  return (
    <StripPopup tip="Background color" trigger={<Swatch color={shown} />} disabled={ctx.locked}>
      <Hint>Background</Hint>
      <ColorPanel
        label="Background color"
        value={written}
        rendered={rendered}
        disabled={ctx.locked}
        onCommit={(next) => ctx.set(fillColorPatch(ctx.inline, ctx.computed, next))}
      />
    </StripPopup>
  );
}

/** Border style, weight (or each side's width) and color. */
function BorderPopup({ ctx }: { ctx: StripContext }) {
  // A border aligned center or outside is drawn by an outline: that is what shows and changes.
  const aligned = readAlignment(ctx.inline).look;
  const short = parseBorder(ctx.inline.border);
  const style = ((aligned?.style ?? ctx.inline['border-style'] ?? short.style ?? ctx.computed['border-top-style'] ?? 'none') as string).split(/\s+/)[0] as BorderStyle;
  const current: BorderStyle = (['none', 'solid', 'dashed', 'dotted'] as const).includes(style as BorderStyle) ? style : 'solid';
  const color = aligned?.color ?? ctx.inline['border-color'] ?? short.color ?? '';
  const widthShort = expandSides(aligned?.width ?? ctx.inline['border-width'] ?? short.width);
  const widths = SIDES.map((side, i) => (aligned ? widthShort?.[i] : ctx.inline[`border-${side}-width`] ?? widthShort?.[i]) ?? '');
  const renderedWidth = roundPx(ctx.computed['border-top-width']);
  const uniform = widths.every((w) => w === widths[0]);
  const [split, setSplit] = useState(!uniform);
  const off = current === 'none';

  /** Writes the border as longhands, dropping the shorthand. */
  const write = (next: { style?: BorderStyle; width?: string | null; color?: string | null; sides?: string[] }) => {
    if (aligned) {
      const patch = alignedLookPatch(ctx.inline, { style: next.style, width: next.width ?? undefined, color: next.color ?? undefined }, ctx.computed);
      if (patch) ctx.set(patch);
      return;
    }
    const patch: Record<string, string | null> = { border: null };
    const nextStyle = next.style ?? current;
    if (nextStyle === 'none') {
      for (const side of SIDES) patch[`border-${side}-width`] = null;
      ctx.set({ ...patch, 'border-style': 'none', 'border-width': null, 'border-color': null });
      return;
    }
    patch['border-style'] = nextStyle;
    // Turning a border on gives it a weight and a color when it has none.
    patch['border-color'] = next.color !== undefined ? next.color : color || (off ? '#141413' : null);
    let sides: (string | null)[] | null = null;
    if (next.sides) sides = next.sides;
    else if (next.width !== undefined) patch['border-width'] = next.width;
    else if (uniform) patch['border-width'] = widths[0] || (off || !Number(renderedWidth) ? '1px' : null);
    else sides = widths.map((w) => w || null);
    if (sides) patch['border-width'] = null;
    SIDES.forEach((side, i) => (patch[`border-${side}-width`] = sides ? sides[i] ?? null : null));
    ctx.set(patch);
  };

  return (
    <StripPopup tip="Border" trigger={<Glyph name="borderWeight" />} disabled={ctx.locked} width="w-[200px]">
      <Hint>Border</Hint>
      <PSegments<BorderStyle>
        value={current}
        disabled={ctx.locked}
        onChange={(next) => write({ style: next })}
        options={[
          { value: 'none', label: 'None', icon: <Ban {...SMALL} /> },
          { value: 'solid', label: 'Solid', icon: <Glyph name="strokeSolid" /> },
          { value: 'dashed', label: 'Dashed', icon: <Glyph name="strokeDashed" /> },
          { value: 'dotted', label: 'Dotted', icon: <Glyph name="strokeDotted" /> },
        ]}
      />
      <fieldset disabled={off || ctx.locked} title={off ? 'Pick a border style first' : undefined} className={cn('m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0', off && 'opacity-60')}>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <PColor aria-label="Border color" value={color} placeholder={off ? undefined : ctx.computed['border-top-color']} disabled={off || ctx.locked} onCommit={(next) => write({ color: next || null })} />
          </div>
          <BorderAlignButton element={ctx.element} computed={ctx.computed} disabled={off || ctx.locked} set={ctx.set} />
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
          {split ? (
            <>
              {(['top', 'right'] as const).map((side) => (
                <SideInput key={side} side={side} widths={widths} placeholder={renderedWidth} disabled={off} onCommit={(sides) => write({ sides })} />
              ))}
              <SplitToggle split label="Same width on every side" disabled={off} onToggle={() => setSplit(false)} />
              {(['bottom', 'left'] as const).map((side) => (
                <SideInput key={side} side={side} widths={widths} placeholder={renderedWidth} disabled={off} onCommit={(sides) => write({ sides })} />
              ))}
              <span />
            </>
          ) : (
            <>
              <PInput
                aria-label="Border weight"
                className="col-span-2"
                prefix={<Glyph name="borderWeight" className="size-3.5" />}
                value={uniform ? fieldValue(widths[0]) : ''}
                placeholder={uniform ? renderedWidth : 'Mixed'}
                unit="px"
                disabled={off || ctx.locked}
                onCommit={(next) => write({ width: next || null })}
              />
              <SplitToggle split={false} label={aligned ? SIDES_NEED_INSIDE : 'Individual borders'} disabled={off || Boolean(aligned)} onToggle={() => setSplit(true)} />
            </>
          )}
        </div>
      </fieldset>
    </StripPopup>
  );
}

/** One side's border width. */
function SideInput({ side, widths, placeholder, disabled, onCommit }: { side: Side; widths: string[]; placeholder: string; disabled?: boolean; onCommit(sides: string[]): void }) {
  const index = SIDES.indexOf(side);
  return (
    <PInput
      aria-label={`${side} border width`}
      prefix={SIDE_INITIAL[side]}
      value={fieldValue(widths[index])}
      placeholder={placeholder}
      unit="px"
      disabled={disabled}
      onCommit={(next) => onCommit(widths.map((w, i) => (i === index ? next || '0px' : w || `${placeholder || 0}px`)))}
    />
  );
}

/** Corner radius, for every corner or each one. */
function RadiusPopup({ ctx }: { ctx: StripContext }) {
  const short = expandSides(ctx.inline['border-radius']?.split('/')[0]);
  // border-radius shorthand order: top-left, top-right, bottom-right, bottom-left.
  const fromShort: Record<Corner, string | undefined> = { 'top-left': short?.[0], 'top-right': short?.[1], 'bottom-right': short?.[2], 'bottom-left': short?.[3] };
  const written = Object.fromEntries(CORNERS.map((c) => [c, ctx.inline[`border-${c}-radius`] ?? fromShort[c] ?? ''])) as Record<Corner, string>;
  const rendered = Object.fromEntries(CORNERS.map((c) => [c, roundPx(ctx.computed[`border-${c}-radius`])])) as Record<Corner, string>;
  const values = CORNERS.map((c) => written[c]);
  const uniform = values.every((v) => v === values[0]) && (values[0] !== '' || CORNERS.every((c) => rendered[c] === rendered['top-left']));
  const [split, setSplit] = useState(!uniform);

  const writeAll = (radius: string | null) => ctx.set({ 'border-radius': radius, ...Object.fromEntries(CORNERS.map((c) => [`border-${c}-radius`, null])) });
  const writeCorner = (corner: Corner, value: string) =>
    ctx.set({
      'border-radius': null,
      ...Object.fromEntries(CORNERS.map((c) => [`border-${c}-radius`, c === corner ? value || null : written[c] || (rendered[c] ? `${rendered[c]}px` : null)])),
    });

  return (
    <StripPopup tip="Corner radius" trigger={<Glyph name="cornerCurve" />} disabled={ctx.locked}>
      <Hint>Corner radius</Hint>
      <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
        {split ? (
          <>
            {(['top-left', 'top-right'] as const).map((c) => (
              <PInput key={c} aria-label={`${c} radius`} prefix={CORNER_INITIAL[c]} value={fieldValue(written[c])} placeholder={rendered[c]} unit="px" disabled={ctx.locked} onCommit={(v) => writeCorner(c, v)} />
            ))}
            <SplitToggle split glyph="borderCorners" label="One radius for every corner" onToggle={() => setSplit(false)} />
            {(['bottom-left', 'bottom-right'] as const).map((c) => (
              <PInput key={c} aria-label={`${c} radius`} prefix={CORNER_INITIAL[c]} value={fieldValue(written[c])} placeholder={rendered[c]} unit="px" disabled={ctx.locked} onCommit={(v) => writeCorner(c, v)} />
            ))}
            <span />
          </>
        ) : (
          <>
            <PInput
              aria-label="Corner radius"
              className="col-span-2"
              prefix={<Glyph name="cornerCurve" className="size-3.5" />}
              value={uniform ? fieldValue(values[0]) : ''}
              placeholder={uniform ? rendered['top-left'] : 'Mixed'}
              unit="px"
              disabled={ctx.locked}
              onCommit={(v) => writeAll(v || null)}
            />
            <SplitToggle split={false} glyph="borderCorners" label="Individual corners" onToggle={() => setSplit(true)} />
          </>
        )}
      </div>
    </StripPopup>
  );
}

/** Padding or margin: horizontal and vertical, or each side. */
function SpacingEditor({ ctx, prop, title }: { ctx: StripContext; prop: 'padding' | 'margin'; title: string }) {
  const short = expandSides(ctx.inline[prop]);
  const written = SIDES.map((side, i) => ctx.inline[`${prop}-${side}`] ?? short?.[i] ?? '');
  const rendered = SIDES.map((side) => roundPx(ctx.computed[`${prop}-${side}`]));
  const same = (a: number, b: number) => written[a] === written[b] && rendered[a] === rendered[b];
  const axial = same(1, 3) && same(0, 2);
  const [split, setSplit] = useState(!axial);

  const write = (values: string[]) => {
    const patch: Record<string, string | null> = { [prop]: null };
    SIDES.forEach((side, i) => (patch[`${prop}-${side}`] = values[i] || null));
    ctx.set(patch);
  };
  const current = (i: number) => written[i] || (rendered[i] ? `${rendered[i]}px` : '');
  const setSides = (indices: number[], value: string) => write(SIDES.map((_, i) => (indices.includes(i) ? value : current(i))));

  const field = (label: string, prefix: string, indices: number[]) => (
    <PInput
      key={label}
      aria-label={`${title} ${label}`}
      prefix={prefix}
      value={fieldValue(written[indices[0]!])}
      placeholder={rendered[indices[0]!]}
      unit="px"
      disabled={ctx.locked}
      onCommit={(v) => setSides(indices, v)}
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Hint>{title}</Hint>
      <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
        {split ? (
          <>
            {field('top', 'T', [0])}
            {field('right', 'R', [1])}
            <SplitToggle split label="Horizontal and vertical" onToggle={() => setSplit(false)} />
            {field('bottom', 'B', [2])}
            {field('left', 'L', [3])}
            <span />
          </>
        ) : (
          <>
            {field('horizontal', 'H', [1, 3])}
            {field('vertical', 'V', [0, 2])}
            <SplitToggle split={false} label="Set each side" onToggle={() => setSplit(true)} />
          </>
        )}
      </div>
    </div>
  );
}

/** Padding and margin. */
function SpacingPopup({ ctx }: { ctx: StripContext }) {
  return (
    <StripPopup tip="Spacing" trigger={<Glyph name="spacing" />} disabled={ctx.locked}>
      <SpacingEditor ctx={ctx} prop="padding" title="Padding" />
      <SpacingEditor ctx={ctx} prop="margin" title="Margin" />
    </StripPopup>
  );
}

/* -------------------------------------------------------------------------- */
/* Text panels                                                                 */
/* -------------------------------------------------------------------------- */

/** First family of a `font-family` list, unquoted. */
function firstFamily(value: string | undefined): string {
  return (value ?? '').split(',')[0]!.trim().replace(/^['"]|['"]$/g, '') || 'Font';
}

/** The typography chip: family · size, opening font, size, weight and line height. */
function TypographyPopup({ ctx }: { ctx: StripContext }) {
  const value = (prop: string) => ctx.inline[prop] ?? ctx.computed[prop];
  const size = ctx.computed['font-size'] ?? ctx.inline['font-size'];
  const sizeText = size && Number.isFinite(parseFloat(size)) ? String(Math.round(parseFloat(size) * 10) / 10) : '';
  return (
    <StripPopup
      tip="Text style"
      wide
      disabled={ctx.locked}
      width="w-[224px]"
      trigger={
        <span className="flex max-w-48 items-center gap-1.5 text-[13px] text-chrome-fg">
          <span className="truncate">{firstFamily(value('font-family'))}</span>
          {sizeText ? <span className="shrink-0 tabular-nums text-chrome-muted">{sizeText}</span> : null}
          <ChevronDown className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
        </span>
      }
    >
      <Hint>Font</Hint>
      <PInput aria-label="Font family" value={ctx.inline['font-family'] ?? ''} placeholder={ctx.computed['font-family']} disabled={ctx.locked} onCommit={(v) => ctx.set({ 'font-family': v || null })} />
      <div className="grid grid-cols-2 gap-1.5">
        <PInput aria-label="Font size" prefix="Size" value={fieldValue(ctx.inline['font-size'])} placeholder={sizeText} unit="px" disabled={ctx.locked} onCommit={(v) => ctx.set({ 'font-size': v || null })} />
        <PInput aria-label="Font weight" prefix="Wt" value={ctx.inline['font-weight'] ?? ''} placeholder={ctx.computed['font-weight']} disabled={ctx.locked} onCommit={(v) => ctx.set({ 'font-weight': v || null })} />
        <PInput aria-label="Line height" prefix="LH" value={ctx.inline['line-height'] ?? ''} placeholder={roundPx(ctx.computed['line-height']) || ctx.computed['line-height']} disabled={ctx.locked} onCommit={(v) => ctx.set({ 'line-height': v || null })} />
        <PInput aria-label="Letter spacing" prefix="LS" value={ctx.inline['letter-spacing'] ?? ''} placeholder={ctx.computed['letter-spacing'] === 'normal' ? '0' : roundPx(ctx.computed['letter-spacing'])} disabled={ctx.locked} onCommit={(v) => ctx.set({ 'letter-spacing': v || null })} />
      </div>
    </StripPopup>
  );
}

/** Text color. */
function TextColorPopup({ ctx }: { ctx: StripContext }) {
  const written = ctx.inline.color ?? '';
  return (
    <StripPopup tip="Text color" trigger={<Swatch color={written || ctx.computed.color} />} disabled={ctx.locked}>
      <Hint>Text color</Hint>
      <PColor aria-label="Text color" value={written} placeholder={toHex(ctx.computed.color) ?? ctx.computed.color} disabled={ctx.locked} onCommit={(next) => ctx.set({ color: next || null })} />
    </StripPopup>
  );
}

/**
 * The link: on an `<a>`, its address; on other text, a link
 * around the whole text (an `<a href>` inside the element).
 */
function LinkPopup({ ctx, board, item, single, readOnly }: { ctx: StripContext; board: string; item: ElementSelection; single: boolean; readOnly: boolean }) {
  const own = ctx.element.tag === 'a';
  const href = own ? (attributeValue(ctx.element, 'href') ?? '') : '';
  const reason = readOnly
    ? 'This project is read-only'
    : !own && !single
      ? 'Link one text at a time'
      : !own && ctx.element.closeStart <= ctx.element.openEnd
        ? 'This element has no text to link'
        : null;
  const tip = reason ?? (own ? (href ? `Edit the link (${href})` : 'Set the link') : 'Link the whole text');
  return (
    <StripPopup tip={tip} trigger={<Link {...ICON} />} disabled={reason !== null} pressed={own && href !== ''} width="w-[260px]" address={href}>
      <Hint>Link</Hint>
      <PInput
        aria-label="Link"
        value={href}
        placeholder="https://"
        onCommit={(value) => {
          const next = value.trim();
          if (own) attributeSelection('href', next || null);
          else if (next) edit(board, { kind: 'linkText', target: { tid: item.tid, path: item.path }, href: next });
        }}
      />
    </StripPopup>
  );
}

/**
 * The link while text is edited
 * selection's link (`link-edit`), then sets, changes or removes it.
 */
function EditingLinkPopup({ disabled }: { disabled: boolean }) {
  const link = useView((s) => s.textEdit?.link ?? null);
  const pressed = useView((s) => s.textEdit?.formats?.link ?? false);
  const open = link !== null;
  const empty = link !== null && link.collapsed && link.href === '';
  const button = <ChromeButton square aria-label="Link" pressed={pressed} disabled={disabled} className={cn(open && 'bg-chrome-hover')} />;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) formatEditedText('link');
        else cancelEditedTextLink();
      }}
    >
      <Tip label={pressed ? 'Edit the link' : 'Link'} shortcut="⌘K" side="top">
        <Popover.Trigger render={button as ReactElement<Record<string, unknown>>}>
          <Link {...ICON} />
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} className="z-[1000]">
          <Popover.Popup
            aria-label="Link"
            {...{ [KEEP_TEXT_EDIT]: '' }}
            onKeyDown={addressCardKeys({ saved: link?.href ?? '', guardDelete: false })}
            className="flex w-[260px] flex-col gap-1.5 rounded-[12px] bg-chrome p-2 text-[13px] font-control text-chrome-fg shadow-chrome-popup outline-none"
          >
            <Hint>Link</Hint>
            {empty ? (
              <div className="px-0.5 pb-0.5 text-[12px] text-chrome-muted">Select the words to link first.</div>
            ) : (
              <div className="flex items-center gap-1">
                <PInput
                  key={link?.href ?? ''}
                  aria-label="Link address"
                  className="min-w-0 flex-1"
                  value={link?.href ?? ''}
                  placeholder="https://"
                  onCommit={(value) => applyEditedTextLink(value)}
                />
                {link?.href ? (
                  <Tip label="Remove the link" side="top">
                    <PIconButton label="Remove the link" onClick={() => applyEditedTextLink('')}>
                      <Unlink className="size-3.5" strokeWidth={1.75} />
                    </PIconButton>
                  </Tip>
                ) : null}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const LISTS = [
  { value: 'none', label: 'No list', icon: Ban },
  { value: 'bullet', label: 'Bulleted list', icon: List },
  { value: 'number', label: 'Numbered list', icon: ListOrdered },
] as const;

type ListValue = (typeof LISTS)[number]['value'];

/** The command that turns a list of kind `current` into `next`: the same command again removes a list. */
function listCommand(next: ListValue, current: ListValue): TextFormat | null {
  if (next === current) return null;
  if (next === 'bullet') return 'ul';
  if (next === 'number') return 'ol';
  return current === 'bullet' ? 'ul' : current === 'number' ? 'ol' : null;
}

/**
 * Lists; on a
 * selected text, its editing starts with every word selected first.
 */
function ListMenu({ editing, current, disabled, onStart }: { editing: boolean; current: ListValue; disabled: boolean; onStart(): boolean }) {
  const shown = LISTS.find((entry) => entry.value === current) ?? LISTS[0];
  const Icon = current === 'number' ? ListOrdered : List;
  return (
    <ChromeMenu
      side="bottom"
      mark={KEEP_TEXT_EDIT}
      tip={{ label: current === 'none' ? 'List' : `List: ${shown.label}`, side: 'top' }}
      trigger={
        <ChromeButton aria-label="List" pressed={current !== 'none'} disabled={disabled} className="gap-0.5 px-1.5">
          <Icon {...ICON} />
          <ChevronDown className="size-3.5 opacity-60" strokeWidth={1.75} />
        </ChromeButton>
      }
    >
      {LISTS.map(({ value, label, icon: ItemIcon }) => (
        <ChromeMenuItem
          key={value}
          checked={value === current}
          icon={<ItemIcon {...SMALL} />}
          onSelect={() => {
            const command = listCommand(value, current);
            if (!command) return;
            if (editing || onStart()) formatEditedText(command);
          }}
        >
          {label}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );
}

const ALIGNS = [
  { value: 'left', label: 'Left', icon: AlignLeft },
  { value: 'center', label: 'Center', icon: AlignCenter },
  { value: 'right', label: 'Right', icon: AlignRight },
  { value: 'justify', label: 'Justify', icon: AlignJustify },
] as const;

/** Text alignment as a menu showing the current one. */
function AlignMenu({ ctx }: { ctx: StripContext }) {
  const raw = ctx.inline['text-align'] ?? ctx.computed['text-align'] ?? 'left';
  const align = raw === 'start' ? 'left' : raw === 'end' ? 'right' : raw;
  const current = ALIGNS.find((a) => a.value === align) ?? ALIGNS[0];
  const Icon = current.icon;
  return (
    <ChromeMenu
      side="bottom"
      tip={{ label: `Alignment: ${current.label}`, side: 'top' }}
      trigger={
        <ChromeButton aria-label="Alignment" disabled={ctx.locked} className="gap-0.5 px-1.5">
          <Icon {...ICON} />
          <ChevronDown className="size-3.5 opacity-60" strokeWidth={1.75} />
        </ChromeButton>
      }
    >
      {ALIGNS.map(({ value, label, icon: AlignIcon }) => (
        <ChromeMenuItem key={value} checked={value === current.value} icon={<AlignIcon {...SMALL} />} onSelect={() => ctx.set({ 'text-align': value })}>
          {label}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );
}

/* -------------------------------------------------------------------------- */
/* Vector and media panels                                                     */
/* -------------------------------------------------------------------------- */

/** SVG drawing tags that take a fill and a stroke. */
const SVG_PAINTED = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path', 'line', 'polyline']);
/** SVG drawing tags that are only a stroke. */
const SVG_STROKED = new Set(['line', 'polyline']);

/** A presentation value: the inline style wins over the attribute. */
const paint = (ctx: StripContext, prop: string) => ctx.inline[prop] ?? attributeValue(ctx.element, prop) ?? '';

/** Fill of an SVG shape. */
function FillPopup({ ctx }: { ctx: StripContext }) {
  const fill = paint(ctx, 'fill');
  return (
    <StripPopup tip="Fill color" trigger={<Swatch color={fill === 'none' ? undefined : fill || '#000000'} />} disabled={ctx.locked}>
      <Hint>Fill</Hint>
      <ColorPanel label="Fill color" value={fill === 'none' ? 'none' : fill} disabled={ctx.locked} onCommit={(next) => ctx.set({ fill: next === 'transparent' ? 'none' : next })} />
    </StripPopup>
  );
}

/** Dash pattern of a stroke style at a weight. */
function dashArray(style: BorderStyle, width: number): string | null {
  if (style === 'dashed') return `${width * 3} ${width * 2}`;
  if (style === 'dotted') return `0 ${width * 2}`;
  return null;
}

/** Stroke of an SVG shape or line: style, weight and color. */
function StrokePopup({ ctx }: { ctx: StripContext }) {
  const stroke = paint(ctx, 'stroke');
  const width = paint(ctx, 'stroke-width');
  const dash = paint(ctx, 'stroke-dasharray');
  const first = Number.parseFloat(dash.split(/[\s,]+/)[0] ?? '');
  const current: BorderStyle = !stroke || stroke === 'none' ? 'none' : !dash || dash === 'none' ? 'solid' : first <= 0.1 ? 'dotted' : 'dashed';
  const off = current === 'none';
  const weight = Number.parseFloat(width) || 1;

  const write = (next: { style?: BorderStyle; width?: string; color?: string | null }) => {
    const style = next.style ?? current;
    if (style === 'none') {
      ctx.set({ stroke: 'none', 'stroke-dasharray': null, 'stroke-linecap': null });
      return;
    }
    const w = next.width !== undefined ? Number.parseFloat(next.width) || 1 : weight;
    ctx.set({
      stroke: next.color !== undefined ? next.color : off ? '#141413' : null,
      'stroke-width': next.width !== undefined ? (next.width ? String(w) : null) : off && !width ? '1' : null,
      'stroke-dasharray': dashArray(style, w) ?? (dash ? 'none' : null),
      'stroke-linecap': style === 'dotted' ? 'round' : null,
    });
  };

  return (
    <StripPopup tip="Stroke" trigger={<Glyph name="borderWeight" />} disabled={ctx.locked}>
      <Hint>Stroke</Hint>
      <PSegments<BorderStyle>
        value={current}
        disabled={ctx.locked}
        onChange={(next) => write({ style: next })}
        options={[
          { value: 'none', label: 'None', icon: <Ban {...SMALL} /> },
          { value: 'solid', label: 'Solid', icon: <Glyph name="strokeSolid" /> },
          { value: 'dashed', label: 'Dashed', icon: <Glyph name="strokeDashed" /> },
          { value: 'dotted', label: 'Dotted', icon: <Glyph name="strokeDotted" /> },
        ]}
      />
      <fieldset disabled={off || ctx.locked} title={off ? 'Pick a stroke style first' : undefined} className={cn('m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0', off && 'opacity-60')}>
        <PColor aria-label="Stroke color" value={off ? '' : stroke} disabled={off || ctx.locked} onCommit={(next) => write({ color: next || null })} />
        <PInput aria-label="Stroke weight" prefix={<Glyph name="borderWeight" className="size-3.5" />} value={fieldValue(width)} placeholder="1" unit="px" step={0.5} disabled={off || ctx.locked} onCommit={(next) => write({ width: withoutUnit(next) })} />
      </fieldset>
    </StripPopup>
  );
}

/** Source (and alt text) of an image or video. */
function SourcePopup({ ctx }: { ctx: StripContext }) {
  const src = attributeValue(ctx.element, 'src') ?? '';
  const image = ctx.element.tag === 'img';
  return (
    <StripPopup tip={image ? 'Replace the image' : 'Replace the video'} trigger={<ImageIcon {...ICON} />} disabled={ctx.locked} width="w-[260px]">
      <Hint>Source</Hint>
      <PInput aria-label="Source URL" value={src.startsWith('data:') ? '' : src} placeholder={src.startsWith('data:') ? 'Embedded data' : 'https://'} disabled={ctx.locked} onCommit={(v) => v && attributeSelection('src', v)} />
      {image ? (
        <>
          <Hint>Alt text</Hint>
          <PInput aria-label="Alt text" value={attributeValue(ctx.element, 'alt') ?? ''} placeholder="Describe the image" disabled={ctx.locked} onCommit={(v) => attributeSelection('alt', v || null)} />
        </>
      ) : null}
    </StripPopup>
  );
}

/** Starts (or ends) the crop editor on the image. */
function CropButton({ ctx, board, item, single }: { ctx: StripContext; board: string; item: ElementSelection; single: boolean }) {
  const crop = useView((s) => s.crop);
  const lockedWhy = useLockedWhy();
  const cropping = crop?.board === board && crop.tid === item.tid;
  const reason = lockedWhy ?? (!single ? 'Crop one image at a time' : null);
  return (
    <StripButton
      tip={reason ?? (cropping ? 'Done cropping' : 'Crop')}
      aria-label="Crop"
      pressed={cropping}
      disabled={ctx.locked || reason !== null}
      onClick={() => useView.getState().setCrop(cropping ? null : { board, tid: item.tid, path: item.path })}
    >
      <Crop {...ICON} />
    </StripButton>
  );
}

/* -------------------------------------------------------------------------- */
/* The strip                                                                   */
/* -------------------------------------------------------------------------- */

/** Component imports: their styles live in the imported file. */
const IMPORTS = new Set(['dc-import', 'x-import']);

/** Locks or unlocks the selection (⌘L), in a group of its own at the strip's start. */
function LockButton({ readOnly }: { readOnly: boolean }) {
  const lock = useSelectionLock();
  if (!lock.lockable) return null;
  const locked = lock.next === false;
  return (
    <>
      <Group>
        <StripButton
          tip={locked ? 'Unlock' : 'Lock'}
          shortcut={`${MOD}L`}
          aria-label="Lock"
          pressed={locked}
          disabled={readOnly}
          onClick={() => toggleSelectionLock()}
        >
          {locked ? <Lock {...ICON} /> : <LockOpen {...ICON} />}
        </StripButton>
      </Group>
      <ChromeDivider />
    </>
  );
}

/** Ask about the selection, and open the properties panel; on touch screens, Delete too. */
function Tail({ lead }: { lead?: ReactNode }) {
  const setPanel = useView((s) => s.setPanel);
  const coarse = useCoarsePointer();
  const readOnly = useDocument((s) => s.readOnly);
  const editing = useView((s) => s.textEdit !== null);
  const lockedWhy = useLockedWhy();
  return (
    <Group>
      {lead}
      {coarse && !readOnly && !editing && lockedWhy === null ? (
        <StripButton tip="Delete" aria-label="Delete" onClick={() => deleteSelection()}>
          <Trash2 {...ICON} />
        </StripButton>
      ) : null}
      <StripButton tip="Open the Properties panel" aria-label="Properties" onClick={() => setPanel('properties', true)}>
        <EllipsisVertical {...ICON} />
      </StripButton>
    </Group>
  );
}

/** A component instance: open its component, or detach it into plain elements. */
function ImportActions({ readOnly }: { readOnly: boolean }) {
  const component = selectedComponentPath();
  const refusal = detachSelectionRefusal();
  return (
    <Group>
      <StripButton
        tip={component ? `Edit component · ${component.replace(/^.*\//, '').replace(/\.dc\.html$/, '')}` : 'Select one instance to edit its component'}
        aria-label="Edit component"
        disabled={!component}
        onClick={() => editSelectedComponent()}
      >
        <Component {...ICON} />
      </StripButton>
      <StripButton
        tip={readOnly ? 'This project is read-only' : (refusal ?? 'Detach instance')}
        aria-label="Detach instance"
        disabled={readOnly || refusal !== null}
        onClick={() => void detachSelection()}
      >
        <Unlink {...ICON} />
      </StripButton>
    </Group>
  );
}

/** The Scale tool's field: a percent (or `1.5x`, or a target width in px), Done and Cancel. */
function ScaleStrip() {
  const factor = useScale((s) => s.factor);
  const width = useScale((s) => s.session?.width ?? 0);
  const format = (f: number) => `${Math.round(f * 10000) / 100}%`;
  const [draft, setDraft] = useState(format(factor));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(format(factor)), [factor]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const apply = (): boolean => {
    const next = parseScaleInput(draft, width);
    if (next === null) {
      setDraft(format(factor));
      return false;
    }
    if (next !== factor) setScaleFactor(next);
    return true;
  };
  return (
    <Group>
      <label className="flex h-6 items-center gap-1.5 rounded-[6px] bg-chrome-field px-2 text-[13px] text-chrome-fg shadow-[inset_0_0_0_1px_var(--dc-field-ring)] focus-within:shadow-[inset_0_0_0_1px_#257de0]">
        <span className="text-[11px] text-chrome-muted">Scale</span>
        <input
          ref={input}
          aria-label="Scale"
          className="w-16 bg-transparent outline-none"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => apply()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              if (isComposingKey(event.nativeEvent)) return;
              apply();
              commitScale();
            } else if (event.key === 'Escape') {
              if (isComposingKey(event.nativeEvent)) return;
              event.preventDefault();
              cancelScale();
            } else if (isComposingKey(event.nativeEvent)) {
              return;
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              const step = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1);
              const next = Math.max(1, Math.round(factor * 100) + step) / 100;
              setScaleFactor(next);
            }
          }}
        />
      </label>
      <ChromeButton onClick={() => (apply(), commitScale())}>Done</ChromeButton>
      <ChromeButton onClick={() => cancelScale()}>Cancel</ChromeButton>
    </Group>
  );
}

export function SelectionBar({ box }: { box: SelectionBarBox }) {
  const selection = useView((s) => s.selection);
  const layoutTick = useView((s) => s.layoutTick);
  const board = selection.kind === 'elements' ? selection.board : null;
  const items: ElementSelection[] = selection.kind === 'elements' ? selection.items : [];
  const first = items[0];
  const source = useDocument((s) => (board ? s.boards[board]?.source ?? null : null));
  const readOnly = useDocument((s) => s.readOnly);
  const scaling = useScale((s) => s.session !== null);
  const textEdit = useView((s) => s.textEdit);

  const element = useMemo(() => (source && first ? resolveElement(templateOf(source), first.tid, first.path) : null), [source, first]);
  const computed = useMemo(
    () => (board && first ? boardApi(board)?.inspect(first.tid)?.computed ?? {} : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, first, source, layoutTick],
  );
  if (!element || !board || !first) return null;

  // A graphic of one shape is edited as that shape: one layer.
  const lone = element.tag === 'svg' ? loneShapeOf(element) : null;
  const ctx: StripContext = lone
    ? { element: lone, inline: layerPaint(element, lone), computed, locked: readOnly || hasDynamicStyle(lone), set: paintSelection }
    : {
        element,
        inline: styleMap(attributeValue(element, 'style') ?? ''),
        computed,
        locked: readOnly || hasDynamicStyle(element),
        set: (patch) => (SVG_PAINTED.has(element.tag) ? paintSelection(patch) : styleSelection(patch)),
      };
  // Remount the popups' local state (split toggles) when the selection changes.
  const key = `${board}:${items.map((item) => item.tid).join(',')}`;
  const kind = elementKind(element);
  const variant = IMPORTS.has(element.tag)
    ? 'import'
    : SVG_PAINTED.has(ctx.element.tag)
      ? 'vector'
      : element.tag === 'img' || element.tag === 'video'
        ? 'media'
        : kind === 'text' || element.tag === 'a' || element.tag === 'button'
          ? 'text'
          : 'box';
  const value = (prop: string) => ctx.inline[prop] ?? computed[prop];
  const bold = Number(value('font-weight') ?? 400) >= 600;
  const italic = value('font-style') === 'italic';
  const underline = (value('text-decoration-line') ?? value('text-decoration') ?? '').includes('underline');
  // While its words are edited, the format buttons act on the selected words.
  const editing = textEdit !== null && textEdit.board === board && textEdit.tid === first.tid && items.length === 1;
  const formats = editing ? textEdit.formats : undefined;
  const plain = editing && textEdit.plain === true;
  const canEditText = items.length === 1 && !readOnly && isTextEditable(element);
  const format = (verb: TextFormat, whole: () => void) => (editing ? formatEditedText(verb) : whole());
  const listValue = formats?.ol ? 'number' : formats?.ul ? 'bullet' : 'none';
  const top = box.top - BAR_SPACE >= 8 ? box.top - BAR_SPACE : box.top + box.height + 8;

  return (
    <div
      className="pointer-events-auto absolute z-10"
      style={{ left: Math.max(8, box.left), top }}
      onPointerDown={(event) => event.stopPropagation()}
      // Keeps focus in the board while text is edited: the buttons act on its selection.
      onMouseDown={(event) => {
        if (editing && !(event.target as Element).closest('input, textarea')) event.preventDefault();
      }}
      data-selection-bar=""
      {...{ [KEEP_TEXT_EDIT]: '' }}
    >
      <TipGroup>
        <Card role="toolbar" aria-label="Selection" className="gap-1 p-1" key={key}>
          {scaling || editing ? null : <LockButton readOnly={readOnly} />}
          {scaling ? (
            <ScaleStrip />
          ) : variant === 'import' ? (
            <>
              <ImportActions readOnly={readOnly} />
              <ChromeDivider />
              <Tail />
            </>
          ) : variant === 'vector' ? (
            <>
              <Group>
                {SVG_STROKED.has(ctx.element.tag) ? null : <FillPopup ctx={ctx} />}
                <StrokePopup ctx={ctx} />
              </Group>
              <ChromeDivider />
              <Tail />
            </>
          ) : variant === 'media' ? (
            <>
              <Group>
                <SourcePopup ctx={ctx} />
                {element.tag === 'img' ? <CropButton ctx={ctx} board={board} item={first} single={items.length === 1} /> : null}
              </Group>
              <ChromeDivider />
              <Group>
                <RadiusPopup ctx={ctx} />
                <BorderPopup ctx={ctx} />
              </Group>
              <ChromeDivider />
              <Tail />
            </>
          ) : variant === 'text' ? (
            <>
              <Group>
                <TypographyPopup ctx={ctx} />
                <TextColorPopup ctx={ctx} />
                <StripButton
                  tip="Bold"
                  shortcut="⌘B"
                  pressed={formats ? formats.bold : bold}
                  disabled={editing ? plain : ctx.locked}
                  onClick={() => format('bold', () => ctx.set({ 'font-weight': bold ? '400' : '700' }))}
                >
                  <Bold {...ICON} />
                </StripButton>
                <StripButton
                  tip="Italic"
                  shortcut="⌘I"
                  pressed={formats ? formats.italic : italic}
                  disabled={editing ? plain : ctx.locked}
                  onClick={() => format('italic', () => ctx.set({ 'font-style': italic ? (ctx.inline['font-style'] === 'italic' ? null : 'normal') : 'italic' }))}
                >
                  <Italic {...ICON} />
                </StripButton>
                <StripButton
                  tip="Underline"
                  shortcut="⌘U"
                  pressed={formats ? formats.underline : underline}
                  disabled={editing ? plain : ctx.locked}
                  onClick={() => format('underline', () => ctx.set({ 'text-decoration': null, 'text-decoration-line': underline ? 'none' : 'underline' }))}
                >
                  <Underline {...ICON} />
                </StripButton>
                {editing ? <EditingLinkPopup disabled={plain} /> : <LinkPopup ctx={ctx} board={board} item={first} single={items.length === 1} readOnly={readOnly} />}
              </Group>
              <ChromeDivider />
              <Group>
                <AlignMenu ctx={ctx} />
                <ListMenu
                  editing={editing}
                  current={listValue}
                  disabled={editing ? plain : !canEditText}
                  onStart={() => startTextEdit(board, first, 'all') && useView.getState().textEdit?.plain !== true}
                />
              </Group>
              <ChromeDivider />
              <Tail
                lead={
                  items.length === 1 && !readOnly && !editing ? (
                    <StripButton tip="Edit the text" aria-label="Edit text" onClick={() => startTextEdit(board, first)}>
                      <PencilLine {...ICON} />
                    </StripButton>
                  ) : null
                }
              />
            </>
          ) : (
            <>
              <Group>
                <BackgroundPopup ctx={ctx} />
                <BorderPopup ctx={ctx} />
              </Group>
              <ChromeDivider />
              <Group>
                <RadiusPopup ctx={ctx} />
                <SpacingPopup ctx={ctx} />
              </Group>
              <ChromeDivider />
              <Tail />
            </>
          )}
        </Card>
      </TipGroup>
    </div>
  );
}

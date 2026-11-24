/**
 * Appearance and effects of the properties panel.
 *
 * - Appearance: Fill (none, a color or a gradient; shapes and lines take a
 *   flat color), Opacity, Radius (one value, or one per corner) and Border
 *   (a stroke style, then its color and its width, one or per side).
 * - Effects: drop and inner shadows, layer blur and background blur, each
 *   added from the section's "+" menu ("Add to Effects") and removed from
 *   its row. On text, "Drop shadow" shadows the letters (`text-shadow`).
 *
 * The other filters, the blend mode and the transform are in Advanced.
 * Values are parsed and formatted by the core so the panel writes exactly
 * what the slide compiler reads.
 */

import { localize } from '@open-artifact/runtime';
import { Ban, Minus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  LIMITS,
  formatBackground,
  formatBorder,
  formatFilters,
  formatShadows,
  isTextual,
  parseBackground,
  parseBorder,
  parseFilters,
  parseShadows,
  type Background,
  type Border,
  type Filters,
  type Shadow,
  type SlideNode,
  type StyleMap,
  type StylePatch,
} from '@open-artifact/slides-core';
import { ChromeMenu, ChromeMenuItem } from '@open-artifact/editor-kit/react';
import { ColorField, ColorRow, useColorGroups } from './ColorField.tsx';
import { fillKindOf, fillKindOptions, fillPreview, startGradient, type FillKind } from './Fills.tsx';
import { GradientEditor } from './GradientEditor.tsx';
import { StrokeDashedIcon, StrokeDottedIcon, StrokeSolidIcon } from './icons.tsx';
import { IconButton, NumberInput, PanelField, QuadRow, Row, Section, Segmented, SliderInput, type Quad } from './kit.tsx';
import { commitCss, patchTarget, sharedStyle, type Target } from './shared.tsx';

/** Why a control is unavailable. */
export const BUILD_OPACITY_REASON = localize('A selected object’s opacity is set by an animation. Ask the agent to change the animation.', '所选对象的不透明度由动画控制。请让 Agent 修改动画。');
const BORDER_REQUIRED_REASON = localize('Add a border first', '请先添加边框');
const SHAPE_SIDES_REASON = localize('A shape draws one stroke all round', '形状四周使用同一种描边');
const LINE_DASH_REASON = localize('A line is solid (a connector can dash)', '直线使用实线，连接线可以使用虚线');
const SILHOUETTE_REASON = localize('Not on diamond or arrow shapes', '菱形和箭头形状不支持此设置');
const INNER_TEXT_REASON = localize('Inner shadow needs a fill or border on this text', '请先给文本添加填充或边框，再设置内阴影');
const MAX_EFFECTS_REASON = localize(`At most ${LIMITS.shadows} per element`, `每个元素最多可添加 ${LIMITS.shadows} 个阴影`);

/** The color a new border starts with. */
export const DEFAULT_STROKE = '#141413';

/** A rule or a line shape. */
export const isLineNode = (n: SlideNode): boolean => n.kind === 'rule' || (n.kind === 'shape' && n.shape === 'line');
/** A shape that strokes all round (`border` only, no sides). */
const strokesAllRound = (n: SlideNode): boolean => n.kind === 'shape' || n.kind === 'rule';
/** A shape drawn with a clip path (no box shadow, no backdrop). */
const isSilhouette = (n: SlideNode): boolean => n.kind === 'shape' && (n.shape === 'diamond' || n.shape.startsWith('arrow-'));

/* -------------------------------------------------------------------------- */
/* Fill                                                                        */
/* -------------------------------------------------------------------------- */

/** Props of {@link FillRow}. */
export interface FillRowProps {
  target: Target;
  /** "Fill", or "Background" for the slide. */
  label?: string;
  /** Offer gradients (boxes and text; not shapes, lines or the slide). */
  gradients?: boolean;
  /** Show a remove button while a fill is set. */
  removable?: boolean;
}

/**
 * The Fill row: a color field whose panel lists the deck's colors, a picker
 * and, where gradients are allowed, a Color / Gradient switch. A shape
 * without a border can't lose its fill (it would vanish).
 */
export function FillRow({ target, label = localize('Fill', '填充'), gradients = false, removable = true }: FillRowProps): ReactNode {
  const groups = useColorGroups();
  const shared = sharedStyle(target, 'background');
  const parsed = shared.value ? parseBackground(shared.value) : null;
  const background: Background | null = parsed?.ok ? parsed.value : null;
  const clipped = sharedStyle(target, 'background-clip').value === 'text';
  const kind = fillKindOf(background);
  const color = background?.color && background.color !== 'transparent' ? background.color : null;
  const set = !shared.mixed && Boolean(color || background?.gradient || background?.image);
  // A shape with no stroke is drawn by its fill alone.
  const needsFill = target.nodes.length > 0 && target.nodes.every((n) => n.kind === 'shape' && !n.style.border);
  const commit = (next: Background | null, what = label): void => {
    commitCss(target, 'background', next ? formatBackground(next) : '', what, 'fill');
  };

  // Text painted with its fill (background-clip:text) is edited under Text › Color.
  if (clipped) {
    return (
      <Row label={label}>
        <ColorField aria-label={label} value={null} groups={groups} preview={fillPreview(background) ?? { swatch: color ?? 'transparent', label: localize('Text fill', '文字填充') }} disabled title={localize('This fill paints the letters — change it under Text › Color', '此填充应用于文字。可在「文本 › 颜色」中更改。')} onCommit={() => undefined} />
      </Row>
    );
  }

  const offerGradient = gradients || kind === 'gradient';
  const kinds: FillKind[] = offerGradient ? ['color', 'gradient'] : [];
  return (
    <Row label={label}>
      <ColorField
        aria-label={label}
        value={shared.mixed ? null : color}
        mixed={shared.mixed}
        allowNone={!needsFill}
        groups={groups}
        preview={fillPreview(background)}
        onCommit={(next) => commit(next ? { color: next } : null)}
        kinds={
          kinds.length > 1 && !shared.mixed
            ? {
                value: kind,
                options: fillKindOptions(kinds),
                onChange: (next) => {
                  if (next === 'gradient' && kind !== 'gradient') commit({ gradient: startGradient(color) }, localize('Gradient', '渐变'));
                  else if (next === 'color' && kind === 'gradient') commit({ color: background?.gradient?.stops[0]?.color ?? DEFAULT_STROKE });
                },
                content: background?.gradient ? <GradientEditor gradient={background.gradient} onChange={(gradient) => commit({ gradient }, localize('Gradient', '渐变'))} /> : null,
              }
            : undefined
        }
      />
      {removable && set ? (
        <IconButton
          label={label === 'Background' ? localize('Remove background', '移除背景') : localize(`Remove ${label.toLowerCase()}`, `移除${label}`)}
          icon={<Minus />}
          disabled={needsFill}
          reason={needsFill ? BORDER_REQUIRED_REASON : undefined}
          onClick={() => commit(null)}
        />
      ) : null}
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/* Opacity, radius                                                             */
/* -------------------------------------------------------------------------- */

/** Opacity: a percentage and a slider (locked while a build animates it). */
export function OpacityRow({ target, lockedReason }: { target: Target; lockedReason?: string }): ReactNode {
  const opacity = sharedStyle(target, 'opacity');
  const [draft, setDraft] = useState<number | null>(null);
  const now = draft ?? Math.round((opacity.value === undefined ? 1 : Number(opacity.value)) * 100);
  const commit = (v: number): void => {
    commitCss(target, 'opacity', v >= 100 ? '' : String(Math.max(0, v) / 100), localize('Opacity', '不透明度'), 'opacity');
  };
  return (
    <Row label={localize('Opacity', '不透明度')} tip={lockedReason}>
      <NumberInput aria-label={localize('Opacity', '不透明度')} className="w-[72px] shrink-0" value={opacity.mixed ? null : now} placeholder={localize('Mixed', '混合值')} unit="%" min={0} max={100} disabled={Boolean(lockedReason)} title={lockedReason} onCommit={(v) => v !== null && commit(v)} />
      <SliderInput
        aria-label={localize('Opacity slider', '不透明度滑块')}
        value={now}
        min={0}
        max={100}
        disabled={Boolean(lockedReason)}
        onChange={(v) => {
          setDraft(v);
          commit(v);
        }}
        onCommit={(v) => {
          setDraft(null);
          commit(v);
        }}
      />
    </Row>
  );
}

/** The four corners of a `border-radius` value (px; a percentage reads as its number). */
function cornersOf(value: string | undefined): Quad {
  const parts = (value ?? '0').trim().split(/\s+/).map((v) => Number.parseFloat(v) || 0);
  const [a = 0, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}

/** Corner radius: one value, or one per corner. */
export function RadiusRow({ target }: { target: Target }): ReactNode {
  const shared = sharedStyle(target, 'border-radius');
  const percent = (shared.value ?? '').includes('%');
  const unit = percent ? '%' : 'px';
  const commit = (next: Quad): void => {
    const value = next.every((c) => c === next[0]) ? (next[0] ? `${next[0]}${unit}` : '') : next.map((c) => `${c}${unit}`).join(' ');
    commitCss(target, 'border-radius', value, localize('Corner radius', '圆角半径'), 'radius');
  };
  return (
    <QuadRow
      label={localize('Radius', '半径')}
      kind="corners"
      values={shared.mixed ? null : cornersOf(shared.value)}
      unit={unit}
      min={0}
      max={percent ? 50 : 256}
      onCommit={commit}
      onReset={shared.value && !shared.mixed ? () => commitCss(target, 'border-radius', '', localize('Corner radius', '圆角半径')) : undefined}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Border                                                                      */
/* -------------------------------------------------------------------------- */

type Stroke = 'none' | 'solid' | 'dashed' | 'dotted';
const SIDE_KEYS = ['border-top', 'border-right', 'border-bottom', 'border-left'] as const;

/** A node's border as the panel edits it: one style and color, a width per side. */
interface BorderState {
  widths: Quad;
  style: Exclude<Stroke, 'none'>;
  color: string;
}

/** Reads the border of a style map (the shorthand, then any side overrides). */
function readBorder(style: StyleMap): BorderState | null {
  const parse = (value: string | undefined): Border | null => {
    const parsed = value ? parseBorder(value, 32) : null;
    return parsed?.ok ? parsed.value : null;
  };
  const all = parse(style.border);
  const sides = SIDE_KEYS.map((key) => parse(style[key]) ?? all);
  const widths = sides.map((b) => (b && b.style !== 'none' ? b.width : 0)) as Quad;
  const drawn = sides.find((b) => b && b.style !== 'none' && b.width > 0);
  if (!drawn) return null;
  const strokeStyle = drawn.style === 'dashed' || drawn.style === 'dotted' ? drawn.style : 'solid';
  return { widths, style: strokeStyle, color: drawn.color };
}

/** The style patch that writes `state` (null removes the border). */
function writeBorder(state: BorderState | null, allRound: boolean): StylePatch {
  const patch: StylePatch = { border: undefined, 'border-top': undefined, 'border-right': undefined, 'border-bottom': undefined, 'border-left': undefined };
  if (!state || state.widths.every((w) => w <= 0)) return patch;
  const stroke = (width: number): string => formatBorder({ width, style: state.style, color: state.color });
  if (allRound || state.widths.every((w) => w === state.widths[0])) {
    patch.border = stroke(Math.max(...state.widths));
    return patch;
  }
  SIDE_KEYS.forEach((key, i) => {
    if (state.widths[i]! > 0) patch[key] = stroke(state.widths[i]!);
  });
  return patch;
}

/** The value shared by every node, or null where they differ. */
function sharedOf<T>(values: readonly T[]): T | null {
  const first = values[0];
  return values.every((v) => JSON.stringify(v) === JSON.stringify(first)) ? (first ?? null) : null;
}

/**
 * Border: the stroke style (none, solid, dashed, dotted), then its color
 * and its width, one value or per side. Shapes stroke all round; a line is
 * solid.
 */
export function BorderRows({ target }: { target: Target }): ReactNode {
  const groups = useColorGroups();
  const styles = target.nodes.length ? target.nodes.map((n) => n.style) : [target.slide.style];
  const states = styles.map(readBorder);
  const allRound = target.nodes.length > 0 && target.nodes.some(strokesAllRound);
  const lines = target.nodes.length > 0 && target.nodes.every(isLineNode);
  const strokeOf = (s: BorderState | null): Stroke => s?.style ?? 'none';
  const stroke = sharedOf(states.map(strokeOf));
  const color = sharedOf(states.map((s) => s?.color ?? null));
  const widths = sharedOf(states.map((s) => s?.widths ?? null));
  const anyBorder = states.some(Boolean);

  /** Rewrites every node's border with `fn` (null removes it). */
  const update = (label: string, fn: (state: BorderState | null) => BorderState | null, coalesce?: string): void => {
    patchTarget(target, label, (node) => writeBorder(fn(readBorder(node?.style ?? target.slide.style)), node ? strokesAllRound(node) : false), coalesce);
  };
  const setStroke = (next: Stroke): void => {
    if (next === 'none') update(localize('Remove border', '移除边框'), () => null);
    else update(localize('Border style', '边框样式'), (s) => ({ widths: s?.widths ?? [1, 1, 1, 1], style: next, color: s?.color ?? DEFAULT_STROKE }));
  };
  const max = allRound ? 32 : 16;

  return (
    <>
      <Row label={localize('Border', '边框')} onReset={anyBorder ? () => setStroke('none') : undefined} resetLabel={localize('Remove border', '移除边框')}>
        <Segmented<Stroke>
          aria-label={localize('Border', '边框')}
          value={stroke}
          options={[
            { value: 'none', label: localize('None', '无'), title: localize('No border', '无边框'), icon: <Ban strokeWidth={1.5} /> },
            { value: 'solid', label: localize('Solid', '实线'), title: localize('Solid', '实线'), icon: <StrokeSolidIcon /> },
            { value: 'dashed', label: localize('Dashed', '虚线'), title: localize('Dashed', '虚线'), icon: <StrokeDashedIcon />, disabled: lines, reason: LINE_DASH_REASON },
            { value: 'dotted', label: localize('Dotted', '点线'), title: localize('Dotted', '点线'), icon: <StrokeDottedIcon />, disabled: lines, reason: LINE_DASH_REASON },
          ]}
          onChange={setStroke}
        />
      </Row>
      {anyBorder ? (
        <>
          <ColorRow
            label={localize('Color', '颜色')}
            aria-label={localize('Border color', '边框颜色')}
            value={color}
            mixed={color === null}
            groups={groups}
            onCommit={(next) => next && update(localize('Border color', '边框颜色'), (s) => (s ? { ...s, color: next } : s), 'border-color')}
            onReset={color && color.toLowerCase() !== DEFAULT_STROKE ? () => update(localize('Border color', '边框颜色'), (s) => (s ? { ...s, color: DEFAULT_STROKE } : s)) : undefined}
          />
          <QuadRow
            label={localize('Width', '宽度')}
            kind="sides"
            values={widths}
            unit="px"
            min={0}
            max={max}
            toggleDisabledReason={allRound ? SHAPE_SIDES_REASON : undefined}
            onCommit={(next) =>
              update(
                localize('Border width', '边框宽度'),
                (s) => {
                  if (!s) return { widths: next, style: 'solid', color: DEFAULT_STROKE };
                  // Zero everywhere would drop the border; keep the thinnest stroke instead.
                  return next.every((w) => w <= 0) ? { ...s, widths: [1, 1, 1, 1] } : { ...s, widths: next };
                },
                'border-width',
              )
            }
          />
        </>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Appearance                                                                  */
/* -------------------------------------------------------------------------- */

/** Props of {@link AppearanceSection}. */
export interface AppearanceSectionProps {
  target: Target;
  /** Show the Fill row (labelled `fillLabel`). */
  fill?: boolean;
  fillLabel?: string;
  /** Offer gradient fills. */
  gradients?: boolean;
  /** Show the Opacity row. */
  opacity?: boolean;
  /** Show the Radius row. */
  radius?: boolean;
  /** Show the Border rows. */
  border?: boolean;
  /** Opacity is driven by a build animation. */
  buildControlled?: boolean;
}

/** Fill, opacity, corner radius and border. */
export function AppearanceSection({ target, fill = true, fillLabel = localize('Fill', '填充'), gradients = false, opacity = true, radius = true, border = true, buildControlled = false }: AppearanceSectionProps): ReactNode {
  if (!fill && !opacity && !radius && !border) return null;
  return (
    <Section title={localize('Appearance', '外观')}>
      {fill ? <FillRow target={target} label={fillLabel} gradients={gradients} removable={target.nodes.length > 0} /> : null}
      {opacity ? <OpacityRow target={target} lockedReason={buildControlled ? BUILD_OPACITY_REASON : undefined} /> : null}
      {radius ? <RadiusRow target={target} /> : null}
      {border ? <BorderRows target={target} /> : null}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Effects                                                                     */
/* -------------------------------------------------------------------------- */

const DROP_SHADOW: Shadow = { inset: false, x: 0, y: 2, blur: 8, spread: 0, color: '#00000033' };
const INNER_SHADOW: Shadow = { inset: true, x: 0, y: 1, blur: 2, spread: 0, color: '#00000033' };
const TEXT_SHADOW: Shadow = { inset: false, x: 0, y: 1, blur: 3, spread: 0, color: '#00000033' };
/** px a blur starts at. */
const BLUR_START = 4;

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** "{x}, {y} · {blur}px". */
function shadowSummary(shadow: Shadow): string {
  return `${fmt(shadow.x)}, ${fmt(shadow.y)} · ${fmt(shadow.blur)}px`;
}

function shadowsOf(target: Target, property: 'box-shadow' | 'text-shadow'): Shadow[] {
  const shared = sharedStyle(target, property);
  const parsed = shared.value && !shared.mixed ? parseShadows(shared.value, property === 'text-shadow') : null;
  return parsed?.ok ? parsed.value : [];
}

function filtersOf(target: Target, property: 'filter' | 'backdrop-filter'): Filters {
  const shared = sharedStyle(target, property);
  const parsed = shared.value && !shared.mixed ? parseFilters(shared.value) : null;
  return parsed?.ok ? parsed.value : {};
}

/** Which effects the selection can take. */
interface EffectSupport {
  /** `box-shadow` (null when unsupported, else the reason it is locked, or ''). */
  box: string | null;
  /** `text-shadow` is the drop shadow (text). */
  text: boolean;
  /** `filter` / `backdrop-filter`. */
  filter: boolean;
  /** Why the backdrop blur is locked ('' when it isn't). */
  backdrop: string;
}

function effectSupport(nodes: readonly SlideNode[]): EffectSupport | null {
  if (nodes.length === 0) return null;
  const boxKinds = new Set(['box', 'text', 'list', 'textbox', 'image', 'table', 'icon', 'shape']);
  const filterKinds = new Set(['box', 'text', 'list', 'textbox', 'image', 'shape']);
  const box = nodes.every((n) => boxKinds.has(n.kind) && !isLineNode(n));
  const filter = nodes.every((n) => filterKinds.has(n.kind) && !isLineNode(n));
  if (!box && !filter) return null;
  const silhouette = nodes.some(isSilhouette);
  return {
    box: box ? (silhouette ? SILHOUETTE_REASON : '') : null,
    text: nodes.every(isTextual),
    filter,
    backdrop: silhouette ? SILHOUETTE_REASON : '',
  };
}

/** Shadows and blurs; "+" adds one, each row's "−" removes it. */
export function EffectsSection({ target }: { target: Target }): ReactNode {
  const support = effectSupport(target.nodes);
  if (!support) return null;
  return <Effects target={target} support={support} />;
}

function Effects({ target, support }: { target: Target; support: EffectSupport }): ReactNode {
  const boxShadows = support.box !== null ? shadowsOf(target, 'box-shadow') : [];
  const textShadows = support.text ? shadowsOf(target, 'text-shadow') : [];
  const filters = support.filter ? filtersOf(target, 'filter') : {};
  const backdrop = support.filter ? filtersOf(target, 'backdrop-filter') : {};
  const [opened, setOpened] = useState<string | null>(null);

  const commitShadows = (property: 'box-shadow' | 'text-shadow', next: Shadow[], label: string): void => {
    commitCss(target, property, next.length ? formatShadows(next, property === 'text-shadow') : '', label, property);
  };
  const setBlur = (property: 'filter' | 'backdrop-filter', amount: number | null, label: string): void => {
    const base = property === 'filter' ? filters : backdrop;
    const next: Filters = { ...base };
    if (amount === null) delete next.blur;
    else next.blur = amount;
    commitCss(target, property, formatFilters(next), label, property);
  };

  // Text: the drop shadow shadows the letters; an inner shadow needs a box to sit in.
  const textHasBox = support.text && target.nodes.every((n) => n.style.background || n.style.border);
  const full = (list: readonly Shadow[]): boolean => list.length >= LIMITS.shadows;
  const dropList = support.text ? textShadows : boxShadows;
  const dropReason = support.text ? (full(textShadows) ? MAX_EFFECTS_REASON : '') : support.box === null ? null : support.box || (full(boxShadows) ? MAX_EFFECTS_REASON : '');
  const innerReason = support.box === null ? null : support.box || (support.text && !textHasBox ? INNER_TEXT_REASON : full(boxShadows) ? MAX_EFFECTS_REASON : '');

  const add = (
    <ChromeMenu
      align="end"
      tip={{ label: localize('Add to Effects', '添加效果') }}
      trigger={
        <button type="button" aria-label={localize('Add to Effects', '添加效果')} className="flex size-6 items-center justify-center rounded-[6px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:ring-2 focus-visible:ring-chrome-accent">
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
      }
    >
      {dropReason !== null ? (
        <ChromeMenuItem
          disabled={dropReason !== ''}
          title={dropReason || undefined}
          onSelect={() => {
            if (support.text) commitShadows('text-shadow', [...textShadows, TEXT_SHADOW], localize('Drop shadow', '外阴影'));
            else commitShadows('box-shadow', [...boxShadows, DROP_SHADOW], localize('Drop shadow', '外阴影'));
            setOpened(`${support.text ? 'text' : 'box'}-${dropList.length}`);
          }}
        >
          {localize('Drop shadow', '外阴影')}
        </ChromeMenuItem>
      ) : null}
      {innerReason !== null ? (
        <ChromeMenuItem
          disabled={innerReason !== ''}
          title={innerReason || undefined}
          onSelect={() => {
            commitShadows('box-shadow', [...boxShadows, INNER_SHADOW], localize('Inner shadow', '内阴影'));
            setOpened(`box-${boxShadows.length}`);
          }}
        >
          {localize('Inner shadow', '内阴影')}
        </ChromeMenuItem>
      ) : null}
      {support.filter ? (
        <>
          <ChromeMenuItem disabled={filters.blur !== undefined} onSelect={() => setBlur('filter', BLUR_START, localize('Layer blur', '图层模糊'))}>
            {localize('Layer blur', '图层模糊')}
          </ChromeMenuItem>
          <ChromeMenuItem disabled={backdrop.blur !== undefined || support.backdrop !== ''} title={support.backdrop || undefined} onSelect={() => setBlur('backdrop-filter', BLUR_START, localize('Background blur', '背景模糊'))}>
            {localize('Background blur', '背景模糊')}
          </ChromeMenuItem>
        </>
      ) : null}
    </ChromeMenu>
  );

  const shadowRows = (property: 'box-shadow' | 'text-shadow', list: Shadow[]): ReactNode =>
    list.map((shadow, i) => {
      const key = `${property === 'text-shadow' ? 'text' : 'box'}-${i}`;
      const label = property === 'text-shadow' ? localize('Drop shadow', '外阴影') : shadow.inset ? localize('Inner shadow', '内阴影') : support.text ? localize('Box shadow', '盒阴影') : localize('Drop shadow', '外阴影');
      const replace = (next: Shadow | null): Shadow[] => (next ? list.map((s, j) => (j === i ? next : s)) : list.filter((_, j) => j !== i));
      return (
        <Row key={key} label={label}>
          <ShadowField
            title={label}
            shadow={shadow}
            spread={property === 'box-shadow'}
            open={opened === key}
            onOpenChange={(open) => setOpened(open ? key : null)}
            onChange={(next) => commitShadows(property, replace(next), label)}
          />
          <IconButton label={localize(`Remove ${label.toLowerCase()}`, `移除${label}`)} icon={<Minus />} onClick={() => commitShadows(property, replace(null), localize(`Remove ${label.toLowerCase()}`, `移除${label}`))} />
        </Row>
      );
    });

  return (
    <Section title={localize('Effects', '效果')} actions={add}>
      {support.text ? shadowRows('text-shadow', textShadows) : null}
      {support.box !== null ? shadowRows('box-shadow', boxShadows) : null}
      {filters.blur !== undefined ? <BlurRow label={localize('Layer blur', '图层模糊')} value={filters.blur} onCommit={(v) => setBlur('filter', v, localize('Layer blur', '图层模糊'))} /> : null}
      {backdrop.blur !== undefined ? <BlurRow label={localize('Background blur', '背景模糊')} value={backdrop.blur} onCommit={(v) => setBlur('backdrop-filter', v, localize('Background blur', '背景模糊'))} /> : null}
    </Section>
  );
}

/** A blur amount in px, with its remove button. */
function BlurRow({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number | null) => void }): ReactNode {
  return (
    <Row label={label}>
      <NumberInput aria-label={label} value={value} placeholder="0" unit="px" min={0} max={20} step={0.5} onCommit={(v) => v !== null && onCommit(v)} />
      <IconButton label={localize(`Remove ${label.toLowerCase()}`, `移除${label}`)} icon={<Minus />} onClick={() => onCommit(null)} />
    </Row>
  );
}

/** Props of {@link ShadowField}. */
interface ShadowFieldProps {
  title: string;
  shadow: Shadow;
  /** Box shadows spread; text shadows don't. */
  spread: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: Shadow) => void;
}

/** One shadow as a field ("0, 2 · 8px"); its panel edits the offset, blur, spread and color. */
function ShadowField({ title, shadow, spread, open, onOpenChange, onChange }: ShadowFieldProps): ReactNode {
  const groups = useColorGroups();
  const patch = (next: Partial<Shadow>): void => onChange({ ...shadow, ...next });
  return (
    <PanelField title={title} text={shadowSummary(shadow)} swatch={shadow.color} open={open} onOpenChange={onOpenChange}>
      <Row label={localize('Offset', '偏移')}>
        <NumberInput aria-label={localize('Horizontal offset', '水平偏移')} label="X" value={shadow.x} min={-64} max={64} steppers={false} onCommit={(v) => v !== null && patch({ x: v })} />
        <NumberInput aria-label={localize('Vertical offset', '垂直偏移')} label="Y" value={shadow.y} min={-64} max={64} steppers={false} onCommit={(v) => v !== null && patch({ y: v })} />
      </Row>
      <Row label={localize('Blur', '模糊')}>
        <NumberInput aria-label={localize('Blur', '模糊')} value={shadow.blur} unit="px" min={0} max={spread ? 160 : 64} onCommit={(v) => v !== null && patch({ blur: v })} />
      </Row>
      {spread ? (
        <Row label={localize('Spread', '扩展范围')}>
          <NumberInput aria-label={localize('Spread', '扩展范围')} value={shadow.spread} unit="px" min={-32} max={32} onCommit={(v) => v !== null && patch({ spread: v })} />
        </Row>
      ) : null}
      <Row label={localize('Color', '颜色')}>
        <ColorField aria-label={localize('Shadow color', '阴影颜色')} value={shadow.color} groups={groups} onCommit={(color) => color && patch({ color })} />
      </Row>
    </PanelField>
  );
}

/**
 * Geometry and layout sections of the properties panel.
 *
 * - Size: for pinned elements their box, position, rotation and alignment
 *   to the slide (or to each other); for flow children each dimension's
 *   size and how it is sized (Hug / Fixed / Fill), a grid child's spans,
 *   the min / max limits "+" adds, and the margin. Grow, shrink, basis, the aspect
 *   ratio and self-alignment are in Advanced.
 * - Containers (a `<div>` or the slide's flow root): Stack, Grid or Layered,
 *   with direction and wrapping, justify / align / distribute, gap and
 *   padding (one value or per side).
 */

import { localize } from '@open-artifact/runtime';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowRight,
  CornerDownLeft,
  Minus,
  Plus,
} from 'lucide-react';
import {
  formatTracks,
  isPinned,
  nodeAt,
  paddingSides,
  parentAt,
  parseTracks,
  pinnedRectOf,
  rotationOf,
  setNodeRect,
  setRotation,
  updateNodeAt,
  type NodePath,
  type Slide,
  type SlideNode,
  type StyleMap,
  type StylePatch,
  type Track,
} from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { ALT, ChromeMenu, ChromeMenuItem } from '@open-artifact/editor-kit/react';
import { IconButton, Note, NumberInput, QuadRow, Row, Section, Segmented, SelectInput, type Quad } from './kit.tsx';
import { ALIGN_KEYS, alignSelection, changeCurrent } from '../../services/commands.ts';
import { useDeck } from '../../state/deck.ts';
import { useView } from '../../state/view.ts';
import { CssField, commitCss, patchTarget, pxOf, sharedStyle, type Target } from './shared.tsx';

/* -------------------------------------------------------------------------- */
/* Pinned geometry                                                             */
/* -------------------------------------------------------------------------- */

/** Position, size and rotation of pinned elements, plus alignment buttons. */
function PinnedSize({ target }: { target: Target }): ReactNode {
  const single = target.nodes.length === 1 ? target.nodes[0]! : null;
  const path = target.paths[0]!;
  const rect = single ? pinnedRectOf(single) : null;

  const setRect = (patch: Partial<{ x: number; y: number; w: number; h: number }>): void => {
    if (!rect) return;
    changeCurrent(localize('Move', '移动'), (slide) => setNodeRect(slide, path, { ...rect, ...patch }));
  };
  const align = (
    [
      ['left', localize('Align left', '左对齐'), AlignStartVertical],
      ['center', localize('Align centers', '水平居中'), AlignCenterVertical],
      ['right', localize('Align right', '右对齐'), AlignEndVertical],
      ['top', localize('Align top', '顶端对齐'), AlignStartHorizontal],
      ['middle', localize('Align middles', '垂直居中'), AlignCenterHorizontal],
      ['bottom', localize('Align bottom', '底端对齐'), AlignEndHorizontal],
    ] as const
  ).map(([edge, label, Icon]) => <IconButton key={edge} size="sm" label={`${target.nodes.length > 1 ? label : localize(`${label} to slide`, `相对幻灯片${label}`)} (${ALT}${ALIGN_KEYS[edge]})`} icon={<Icon className="size-3.5" />} onClick={() => alignSelection(edge)} />);

  return (
    <Section title={localize('Size', '大小')}>
      {rect && single ? (
        <>
          <Row label={localize('Width', '宽度')}>
            <NumberInput aria-label={localize('Width', '宽度')} value={rect.w} min={1} unit="px" onCommit={(v) => v !== null && setRect({ w: v })} />
          </Row>
          <Row label={localize('Height', '高度')}>
            <NumberInput aria-label={localize('Height', '高度')} value={rect.h} min={1} unit="px" onCommit={(v) => v !== null && setRect({ h: v })} />
          </Row>
          <Row label={localize('Position', '位置')}>
            <NumberInput aria-label="X" label="X" value={rect.x} onCommit={(v) => v !== null && setRect({ x: v })} />
            <NumberInput aria-label="Y" label="Y" value={rect.y} onCommit={(v) => v !== null && setRect({ y: v })} />
          </Row>
          <Row label={localize('Rotation', '旋转角度')}>
            <NumberInput
              aria-label={localize('Rotation', '旋转角度')}
              value={rotationOf(single)}
              unit="°"
              min={-180}
              max={180}
              onCommit={(v) => changeCurrent(localize('Rotate', '旋转'), (slide) => setRotation(slide, path, v ?? 0))}
            />
          </Row>
        </>
      ) : null}
      <Row label={localize('Align', '对齐')}>
        <div className="flex flex-wrap items-center gap-0.5">{align}</div>
      </Row>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Flow children                                                               */
/* -------------------------------------------------------------------------- */

type SizeMode = 'hug' | 'fixed' | 'fill';
type Dimension = 'w' | 'h';

/** How the parent lays out its children. */
interface ParentLayout {
  kind: 'stack' | 'grid';
  /** Stack direction. */
  row: boolean;
  /** The parent's align-items (stretch by default). */
  alignItems: string;
}

function parentLayout(slide: Slide, path: NodePath): ParentLayout {
  const style: StyleMap = (path.length > 1 ? parentAt(slide, path)?.style : slide.style) ?? {};
  return {
    kind: style.display === 'grid' ? 'grid' : 'stack',
    row: style['flex-direction'] === 'row' || style['flex-direction'] === 'row-reverse',
    alignItems: style['align-items'] ?? 'stretch',
  };
}

/** True when `dimension` runs along the parent's main axis. */
function isMain(parent: ParentLayout, dimension: Dimension): boolean {
  return parent.kind === 'stack' && parent.row === (dimension === 'w');
}

/** The self-alignment property that sizes a cross-axis / cell dimension. */
function selfKey(parent: ParentLayout, dimension: Dimension): 'align-self' | 'justify-self' {
  return parent.kind === 'grid' && dimension === 'w' ? 'justify-self' : 'align-self';
}

/** Reads the size mode of a flow child along one dimension. */
function sizeModeOf(node: SlideNode, parent: ParentLayout, dimension: Dimension): SizeMode {
  const size = node.style[dimension === 'w' ? 'width' : 'height'];
  if (size && size !== 'auto' && size !== '100%') return 'fixed';
  if (size === '100%') return 'fill';
  if (isMain(parent, dimension)) {
    const flex = node.style.flex ?? '';
    return /^[1-9]/.test(flex) || Number(node.style['flex-grow'] ?? 0) > 0 ? 'fill' : 'hug';
  }
  const self = node.style[selfKey(parent, dimension)];
  if (self) return self === 'stretch' ? 'fill' : 'hug';
  // No self-alignment: the parent's align-items decides (grid cells stretch too).
  return parent.alignItems === 'stretch' || parent.alignItems === 'normal' ? 'fill' : 'hug';
}

/** The style patch that gives a flow child `mode` along `dimension`. */
function sizeModePatch(node: SlideNode, parent: ParentLayout, dimension: Dimension, mode: SizeMode, measured: number): StylePatch {
  const sizeKey = dimension === 'w' ? 'width' : 'height';
  if (isMain(parent, dimension)) {
    if (mode === 'fill') return { [sizeKey]: undefined, flex: '1', 'flex-grow': undefined, 'flex-basis': undefined };
    if (mode === 'fixed') return { [sizeKey]: `${Math.round(measured)}px`, flex: 'none', 'flex-grow': undefined };
    return { [sizeKey]: undefined, flex: undefined, 'flex-grow': undefined, 'flex-basis': undefined };
  }
  const key = selfKey(parent, dimension);
  if (mode === 'fill') return { [sizeKey]: undefined, [key]: 'stretch' };
  if (mode === 'fixed') return { [sizeKey]: `${Math.round(measured)}px`, [key]: node.style[key] === 'stretch' ? undefined : node.style[key] };
  return { [sizeKey]: undefined, [key]: 'start' };
}

/** A grid child's `span N` (1 when not spanning). */
function spanOf(value: string | undefined): number {
  const m = value ? /span\s+(\d+)/.exec(value) : null;
  return m ? Number(m[1]) : 1;
}

/** The element at `path` on the stage. */
function stageElement(path: NodePath): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-open-artifact-stage] [data-open-artifact-path="${path.join('.')}"]`);
}

/**
 * The layout size of a stage element in slide px. HTML elements report it
 * directly; an SVG element (a connector) is measured on screen and scaled
 * back by its nearest HTML ancestor's zoom.
 */
function boxSize(el: Element): { w: number; h: number } {
  if (el instanceof HTMLElement) return { w: el.offsetWidth, h: el.offsetHeight };
  const rect = el.getBoundingClientRect();
  let host = el.parentElement;
  while (host && host.offsetWidth === 0) host = host.parentElement;
  const zoom = host ? host.getBoundingClientRect().width / host.offsetWidth || 1 : 1;
  return { w: Math.round(rect.width / zoom), h: Math.round(rect.height / zoom) };
}

/** The measured size of the element at `path` on the stage, in slide px. */
function measuredSize(path: NodePath): { w: number; h: number } {
  const el = stageElement(path);
  return el ? boxSize(el) : { w: 240, h: 120 };
}

/** The live size of the element at `path` on the stage (null until it shows). */
function useMeasured(path: NodePath | null): { w: number; h: number } | null {
  const key = path ? path.join('.') : null;
  const revision = useDeck((s) => s.revision);
  // Starting or ending a text edit swaps the element for the editor (or
  // back), so the observer has to move to the new one.
  const editing = useView((s) => s.textEdit !== null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let observer: ResizeObserver | null = null;
    // Wait a frame so the stage has rendered this revision.
    const frame = requestAnimationFrame(() => {
      const el = stageElement(key.split('.').map(Number));
      if (!el) return setSize(null);
      const read = (): void => {
        const { w, h } = boxSize(el);
        // A hidden element (the text editor covers it while typing) measures
        // 0 × 0: keep the last real size rather than show zeros.
        if (w === 0 && h === 0) return;
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      };
      read();
      observer = new ResizeObserver(read);
      observer.observe(el);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [key, revision, editing]);
  return size;
}

const SIZE_TIP = (label: string): string => localize(`${label}: Hug sizes to the content, Fixed is an exact size, Fill takes the space the group gives it.`, `${label}：适应内容会随内容调整，固定大小使用指定数值，填充会占用组合分配的空间。`);

/** The limits "+" can add to Size. */
type Limit = 'min-width' | 'max-width' | 'min-height' | 'max-height';
const LIMITS: ReadonlyArray<{ key: Limit; label: string }> = [
  { key: 'min-width', label: localize('Min width', '最小宽度') },
  { key: 'max-width', label: localize('Max width', '最大宽度') },
  { key: 'min-height', label: localize('Min height', '最小高度') },
  { key: 'max-height', label: localize('Max height', '最大高度') },
];

/**
 * Size of the selection. Pinned elements get their box, position, rotation
 * and alignment; flow children get each dimension as a number (the fixed
 * size, or the measured one) and how it is sized (Hug / Fixed / Fill), the
 * grid spans of a grid child, and the limits "+" adds.
 */
export function SizeSection({ target }: { target: Target }): ReactNode {
  const selectionKey = target.paths.map((p) => p.join('.')).join('|');
  const [revealed, setRevealed] = useState<ReadonlySet<Limit>>(new Set());
  useEffect(() => setRevealed(new Set()), [selectionKey]);
  const measured = useMeasured(target.nodes.length === 1 ? target.paths[0]! : null);
  if (target.nodes.length === 0) return null;
  if (target.nodes.every((n) => isPinned(n) && n.kind !== 'connector')) return <PinnedSize target={target} />;
  if (target.nodes.some((n) => isPinned(n))) return null;
  const path = target.paths[0]!;
  const node = target.nodes[0]!;
  const parent = parentLayout(target.slide, path);
  const shown = (key: Limit): boolean => revealed.has(key) || target.nodes.some((n) => n.style[key] !== undefined);

  const setMode = (dimension: Dimension, mode: SizeMode, px?: number): void => {
    changeCurrent(localize('Size', '大小'), (slide) => {
      let next = slide;
      for (const p of target.paths) {
        const n = nodeAt(next, p);
        if (!n) continue;
        const size = measuredSize(p);
        const patch = sizeModePatch(n, parentLayout(next, p), dimension, mode, px ?? (dimension === 'w' ? size.w : size.h));
        next = updateNodeAt(next, p, (m) => ({ ...m, style: applyPatch(m.style, patch) }) as SlideNode);
      }
      return next;
    });
  };

  const dimensionRow = (dimension: Dimension): ReactNode => {
    const mode = sizeModeOf(node, parent, dimension);
    const property = dimension === 'w' ? 'width' : 'height';
    const label = dimension === 'w' ? localize('Width', '宽度') : localize('Height', '高度');
    const fixed = mode === 'fixed' ? pxOf(node.style[property]) : null;
    const value = fixed ?? (measured ? Math.round(dimension === 'w' ? measured.w : measured.h) : null);
    return (
      <Row label={label} tip={SIZE_TIP(label)}>
        <NumberInput
          aria-label={label}
          value={target.nodes.length === 1 ? value : null}
          placeholder={target.nodes.length === 1 ? localize('Auto', '自动') : localize('Mixed', '混合值')}
          min={1}
          max={4096}
          step={8}
          onCommit={(v) => v !== null && setMode(dimension, 'fixed', v)}
        />
        <SelectInput<SizeMode>
          aria-label={localize(`${label} sizing`, `${label}的尺寸方式`)}
          className="w-[76px] shrink-0"
          value={target.nodes.every((n, i) => sizeModeOf(n, parentLayout(target.slide, target.paths[i]!), dimension) === mode) ? mode : null}
          placeholder={localize('Mixed', '混合值')}
          options={[
            { value: 'hug', label: localize('Hug', '适应内容') },
            { value: 'fixed', label: localize('Fixed', '固定大小') },
            { value: 'fill', label: localize('Fill', '填充') },
          ]}
          onChange={(value) => setMode(dimension, value)}
        />
      </Row>
    );
  };

  const add = (
    <ChromeMenu
      align="end"
      tip={{ label: localize('Add to Size', '添加尺寸设置') }}
      trigger={
        <button type="button" aria-label={localize('Add to Size', '添加尺寸设置')} className="flex size-6 items-center justify-center rounded-[6px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:ring-2 focus-visible:ring-chrome-accent">
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
      }
    >
      {LIMITS.map(({ key, label }) => (
        <ChromeMenuItem key={key} disabled={shown(key)} onSelect={() => setRevealed(new Set([...revealed, key]))}>
          {label}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );

  const columns = parent.kind === 'grid' ? gridColumnCount(target.slide, path) : 0;
  return (
    <Section title={localize('Size', '大小')} actions={add}>
      {dimensionRow('w')}
      {dimensionRow('h')}
      {LIMITS.filter(({ key }) => shown(key)).map(({ key, label }) => {
        const shared = sharedStyle(target, key);
        return (
          <Row
            key={key}
            label={label}
            onReset={() => {
              commitCss(target, key, '', label);
              const next = new Set(revealed);
              next.delete(key);
              setRevealed(next);
            }}
            resetLabel={localize(`Remove ${label.toLowerCase()}`, `移除${label}`)}
          >
            <NumberInput
              aria-label={label}
              value={shared.mixed ? null : pxOf(shared.value)}
              placeholder={shared.mixed ? localize('Mixed', '混合值') : key.startsWith('min') ? '0' : '—'}
              unit="px"
              min={key.startsWith('min') ? 0 : 1}
              max={4096}
              step={8}
              onCommit={(v) => commitCss(target, key, v === null ? '' : `${v}px`, label)}
            />
          </Row>
        );
      })}
      {parent.kind === 'grid' ? (
        <>
          <Row label={localize('Column span', '跨列数')} tip={localize('Grid cells this child spans across (row-major auto-flow).', '子元素横跨的网格列数（按行自动排列）。')}>
            <NumberInput aria-label={localize('Column span', '跨列数')} value={spanOf(node.style['grid-column'])} placeholder="1" min={1} max={Math.max(1, columns)} onCommit={(v) => commitCss(target, 'grid-column', !v || v <= 1 ? '' : `span ${Math.round(v)}`, localize('Column span', '跨列数'))} />
          </Row>
          <Row label={localize('Row span', '跨行数')}>
            <NumberInput aria-label={localize('Row span', '跨行数')} value={spanOf(node.style['grid-row'])} placeholder="1" min={1} max={12} onCommit={(v) => commitCss(target, 'grid-row', !v || v <= 1 ? '' : `span ${Math.round(v)}`, localize('Row span', '跨行数'))} />
          </Row>
        </>
      ) : null}
      <MarginRow target={target} />
    </Section>
  );
}

/** The four sides of a margin as written: px numbers, or `auto`. */
function marginSides(value: string | undefined): [Side, Side, Side, Side] {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [0, 0, 0, 0];
  const [t, r = t, b = t, l = r] = parts.map((part): Side => (part === 'auto' ? 'auto' : (pxOf(part) ?? 0)));
  return [t!, r!, b!, l!];
}

type Side = number | 'auto';

const sideNumber = (side: Side): number => (side === 'auto' ? 0 : side);

/** Margin of a flow child: one value, or one per side; an `auto` side stays `auto` until it is typed over. */
function MarginRow({ target }: { target: Target }): ReactNode {
  const shared = sharedStyle(target, 'margin');
  const sides = shared.mixed ? null : marginSides(shared.value);
  const shown: Quad | null = sides ? [sideNumber(sides[0]), sideNumber(sides[1]), sideNumber(sides[2]), sideNumber(sides[3])] : null;
  const commit = (next: Quad): void => {
    const written = next.map((v, i) => (sides?.[i] === 'auto' && v === shown?.[i] ? 'auto' : `${v}px`));
    commitCss(target, 'margin', written.every((v) => v === '0px') ? '' : written.join(' '), localize('Margin', '外边距'), 'margin');
  };
  return (
    <QuadRow
      label={localize('Margin', '外边距')}
      kind="sides"
      values={shown}
      unit="px"
      min={-1920}
      max={1920}
      title={localize('Space outside the element, between it and its neighbours.', '元素与相邻元素之间的外部留白。')}
      onCommit={commit}
      onReset={shared.value && !shared.mixed ? () => commitCss(target, 'margin', '', localize('Margin', '外边距')) : undefined}
    />
  );
}

/** How many columns the grid holding `path` has. */
function gridColumnCount(slide: Slide, path: NodePath): number {
  const style: StyleMap = (path.length > 1 ? parentAt(slide, path)?.style : slide.style) ?? {};
  const parsed = style['grid-template-columns'] ? parseTracks(style['grid-template-columns']) : null;
  return parsed?.ok ? parsed.value.length : 12;
}

function applyPatch(style: StyleMap, patch: StylePatch): StyleMap {
  const next: StyleMap = { ...style };
  for (const [key, value] of Object.entries(patch) as Array<[keyof StyleMap, string | undefined]>) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Containers                                                                  */
/* -------------------------------------------------------------------------- */

type ContainerKind = 'stack' | 'grid' | 'layered';
type Edge = 'start' | 'center' | 'end';

const GRID_ALIGN_OPTIONS = [
  { value: 'stretch', label: localize('Stretch', '拉伸') },
  { value: 'start', label: localize('Start', '起点') },
  { value: 'center', label: localize('Center', '居中') },
  { value: 'end', label: localize('End', '终点') },
] as const;

/** A justify / align keyword as start, center or end (null for stretch, baseline, a distribution). */
function edgeOf(value: string | undefined): Edge | null {
  switch (value) {
    case 'start':
    case 'flex-start':
      return 'start';
    case 'center':
      return 'center';
    case 'end':
    case 'flex-end':
      return 'end';
    default:
      return null;
  }
}

/** The next form of a grid track when clicked: share → fixed 240px → content → share. */
function cycleTrack(track: Track): Track {
  if (track.unit === 'fr') return { unit: 'px', value: 240 };
  if (track.unit === 'px') return { unit: 'auto' };
  return { unit: 'fr', value: 1 };
}

function trackLabel(track: Track): string {
  return track.unit === 'auto' ? localize('Auto', '自动') : `${track.value}${track.unit}`;
}

/** Justify and align icons along the stack's main and cross axes. */
const ROW_ICONS = {
  justify: { start: AlignHorizontalJustifyStart, center: AlignHorizontalJustifyCenter, end: AlignHorizontalJustifyEnd },
  align: { start: AlignVerticalJustifyStart, center: AlignVerticalJustifyCenter, end: AlignVerticalJustifyEnd },
} as const;
const COLUMN_ICONS = { justify: ROW_ICONS.align, align: ROW_ICONS.justify } as const;

/**
 * Layout of a container: the selected `<div>` (one, not a group of pinned
 * shapes) or the slide's own flow root when the slide is the target. Text
 * elements lay out their own lines: only their padding is offered.
 */
export function LayoutSection({ target }: { target: Target }): ReactNode {
  const node = target.nodes.length === 1 ? target.nodes[0]! : null;
  const isSlide = target.nodes.length === 0;
  if (!isSlide && target.nodes.every((n) => n.kind === 'text' || n.kind === 'list' || n.kind === 'textbox')) {
    return (
      <Section title={localize('Layout', '布局')}>
        <PaddingRow target={target} />
      </Section>
    );
  }
  if (!isSlide && node?.kind !== 'box') return null;
  if (node?.kind === 'box' && node.group) return null;
  const style = isSlide ? target.slide.style : node!.style;
  const kind: ContainerKind = style.display === 'grid' ? 'grid' : style.position === 'relative' ? 'layered' : 'stack';
  return (
    <Section title={localize('Layout', '布局')}>
      <Row>
        <Segmented<ContainerKind>
          aria-label={localize('Layout', '布局')}
          value={kind}
          options={[
            { value: 'stack', label: localize('Stack', '堆叠'), title: localize('Children follow one another', '子元素依次排列') },
            { value: 'grid', label: localize('Grid', '网格'), title: localize('Children fill a grid of columns', '子元素按网格列排列') },
            ...(isSlide ? [] : [{ value: 'layered' as const, label: localize('Layered', '层叠'), title: localize('Children are placed freely on top of each other', '子元素可自由摆放和重叠') }]),
          ]}
          onChange={(next) => setContainerKind(target, style, kind, next, isSlide)}
        />
      </Row>
      {kind === 'stack' ? <StackRows target={target} style={style} /> : null}
      {kind === 'grid' ? <GridRows target={target} style={style} /> : null}
      {kind === 'layered' ? <Note>{localize('Children are placed freely. Drag them on the slide to arrange them.', '子元素可以自由摆放。拖动幻灯片上的元素即可排列。')}</Note> : null}
      {kind !== 'layered' ? (
        <Row label={localize('Gap', '间距')}>
          <NumberInput
            aria-label={localize('Gap', '间距')}
            value={sharedStyle(target, 'gap').mixed ? null : (pxOf(style.gap?.split(/\s+/)[0]) ?? 0)}
            placeholder={localize('Mixed', '混合值')}
            min={0}
            max={512}
            onCommit={(v) => commitCss(target, 'gap', v ? `${v}px` : '', localize('Gap', '间距'), 'gap')}
          />
        </Row>
      ) : null}
      <PaddingRow target={target} />
    </Section>
  );
}

function setContainerKind(target: Target, style: StyleMap, kind: ContainerKind, next: ContainerKind, isSlide: boolean): void {
  if (next === kind) return;
  if (next === 'grid') {
    patchTarget(target, localize('Grid layout', '网格布局'), {
      display: 'grid',
      'grid-template-columns': formatTracks([{ unit: 'fr', value: 1 }, { unit: 'fr', value: 1 }]),
      'flex-direction': undefined,
      'flex-wrap': undefined,
      'justify-content': undefined,
      position: isSlide ? undefined : style.position === 'relative' ? undefined : style.position,
    });
  } else if (next === 'stack') {
    patchTarget(target, localize('Stack layout', '堆叠布局'), { display: undefined, 'grid-template-columns': undefined, 'grid-template-rows': undefined, 'justify-items': undefined, position: style.position === 'relative' ? undefined : style.position });
  } else {
    patchTarget(target, localize('Layered layout', '层叠布局'), { position: 'relative', display: undefined, 'grid-template-columns': undefined, 'grid-template-rows': undefined });
  }
}

/** A stack's direction and wrapping, then how its children justify, align and distribute. */
function StackRows({ target, style }: { target: Target; style: StyleMap }): ReactNode {
  const row = style['flex-direction'] === 'row' || style['flex-direction'] === 'row-reverse';
  const wrap = style['flex-wrap'] === 'wrap';
  const distributed = style['justify-content'] === 'space-between';
  const justify = style['justify-content'] ? edgeOf(style['justify-content']) : 'start';
  const align = edgeOf(style['align-items']);
  const icons = row ? ROW_ICONS : COLUMN_ICONS;
  const edges = (which: 'justify' | 'align', prefix: string) =>
    (['start', 'center', 'end'] as const).map((edge) => {
      const Icon = icons[which][edge];
      return { value: edge, label: `${prefix} ${edge}`, title: `${prefix} ${edge}`, icon: <Icon strokeWidth={1.5} />, disabled: which === 'justify' && distributed, reason: localize('Distribute decides this axis', '此轴由分布方式控制') };
    });
  const DistributeIcon = row ? AlignHorizontalSpaceBetween : AlignVerticalSpaceBetween;
  return (
    <>
      <Row label={localize('Direction', '方向')}>
        <Segmented<'h' | 'v'>
          aria-label={localize('Direction', '方向')}
          value={row ? 'h' : 'v'}
          options={[
            { value: 'h', label: localize('Horizontal', '水平'), title: localize('Horizontal', '水平'), icon: <ArrowRight strokeWidth={1.5} /> },
            { value: 'v', label: localize('Vertical', '垂直'), title: localize('Vertical', '垂直'), icon: <ArrowDown strokeWidth={1.5} /> },
          ]}
          onChange={(dir) => patchTarget(target, localize('Direction', '方向'), dir === 'h' ? { 'flex-direction': 'row' } : { 'flex-direction': undefined, 'flex-wrap': undefined })}
        />
        <IconButton
          label={wrap ? localize('Children wrap onto more rows — click for one row', '子元素自动换行。点击改为单行。') : localize('Wrap children onto more rows', '允许子元素自动换行')}
          icon={<CornerDownLeft strokeWidth={1.5} />}
          active={wrap}
          disabled={!row}
          reason={!row ? localize('Wrap applies to a horizontal stack', '自动换行适用于水平堆叠布局') : undefined}
          onClick={() => commitCss(target, 'flex-wrap', wrap ? '' : 'wrap', localize('Wrap', '换行'))}
        />
      </Row>
      <Row
        label={localize('Align', '对齐')}
        onReset={style['justify-content'] || style['align-items'] ? () => patchTarget(target, localize('Align', '对齐'), { 'justify-content': undefined, 'align-items': undefined }) : undefined}
      >
        <div className={cn('flex min-w-0 flex-1 gap-2', row ? 'items-center' : 'items-start')}>
          <Segmented<Edge> aria-label={localize('Justify', '两端对齐')} vertical={!row} className={row ? 'min-w-0 flex-1' : undefined} value={justify} options={edges('justify', localize('Justify', '两端对齐'))} onChange={(edge) => commitCss(target, 'justify-content', edge === 'start' ? '' : edge, localize('Justify', '两端对齐'))} />
          <Segmented<Edge> aria-label={localize('Align', '对齐')} vertical={!row} className={row ? 'min-w-0 flex-1' : undefined} value={align} options={edges('align', localize('Align', '对齐'))} onChange={(edge) => commitCss(target, 'align-items', edge, localize('Align', '对齐'))} />
        </div>
        <IconButton
          label={distributed ? localize('Distribute: space between — click to pack', '当前均匀分布。点击切换为紧凑排列。') : localize('Distribute (space between); needs main-axis room to show', '均匀分布（主轴上需要有剩余空间）')}
          icon={<DistributeIcon strokeWidth={1.5} />}
          active={distributed}
          onClick={() => commitCss(target, 'justify-content', distributed ? '' : 'space-between', localize('Distribute', '均匀分布'))}
        />
      </Row>
    </>
  );
}

/** A grid's columns (click a track to cycle it), rows and cell alignment. */
function GridRows({ target, style }: { target: Target; style: StyleMap }): ReactNode {
  const parsed = style['grid-template-columns'] ? parseTracks(style['grid-template-columns']) : null;
  const tracks: Track[] = parsed?.ok ? parsed.value : [];
  const setTracks = (next: Track[]): void => {
    if (next.length > 0) commitCss(target, 'grid-template-columns', formatTracks(next), localize('Grid columns', '网格列'));
  };
  return (
    <>
      <Row label={localize('Columns', '列数')}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {tracks.map((track, i) => (
            <button
              key={i}
              type="button"
              title={localize('Click to switch between a share, a fixed 240px and the content\'s size', '点击切换为按比例分配、固定 240 像素或适应内容。')}
              className="h-6 rounded-[6px] bg-chrome-field px-1.5 text-[12px] tabular-nums text-chrome-fg shadow-[inset_0_0_0_1px_var(--chrome-field-ring)] hover:shadow-[inset_0_0_0_1px_var(--chrome-field-ring-strong)]"
              onClick={() => setTracks(tracks.map((t, j) => (j === i ? cycleTrack(t) : t)))}
            >
              {trackLabel(track)}
            </button>
          ))}
          <IconButton label={localize('Add column', '添加列')} icon={<Plus strokeWidth={1.5} />} disabled={tracks.length >= 12} reason={tracks.length >= 12 ? localize('12 columns at most', '最多 12 列') : undefined} onClick={() => setTracks([...tracks, { unit: 'fr', value: 1 }])} />
          <IconButton label={localize('Remove column', '移除列')} icon={<Minus strokeWidth={1.5} />} disabled={tracks.length <= 1} reason={tracks.length <= 1 ? localize('A grid keeps one column', '网格至少保留一列') : undefined} onClick={() => setTracks(tracks.slice(0, -1))} />
        </div>
      </Row>
      <Row label={localize('Rows', '行数')}>
        <CssField target={target} property="grid-template-rows" label={localize('Grid rows', '网格行数')} placeholder="auto" />
      </Row>
      <Row label={localize('Align', '对齐')}>
        <SelectInput aria-label={localize('Justify items', '子元素主轴对齐')} value={style['justify-items'] ?? 'stretch'} options={GRID_ALIGN_OPTIONS.map((o) => ({ ...o }))} onChange={(value) => commitCss(target, 'justify-items', value === 'stretch' ? '' : value, localize('Align columns', '列对齐'))} />
        <SelectInput aria-label={localize('Align items', '对齐元素')} value={edgeOf(style['align-items']) ?? 'stretch'} options={GRID_ALIGN_OPTIONS.map((o) => ({ ...o }))} onChange={(value) => commitCss(target, 'align-items', value === 'stretch' ? '' : value, localize('Align rows', '行对齐'))} />
      </Row>
    </>
  );
}

/** Padding: one value, or one per side. */
function PaddingRow({ target }: { target: Target }): ReactNode {
  const shared = sharedStyle(target, 'padding');
  const commit = (next: Quad): void => {
    const all = next.every((v) => v === next[0]);
    commitCss(target, 'padding', all ? (next[0] ? `${next[0]}px` : '') : next.map((v) => `${v}px`).join(' '), localize('Padding', '内边距'), 'padding');
  };
  return (
    <QuadRow
      label={localize('Padding', '内边距')}
      kind="sides"
      values={shared.mixed ? null : paddingSides(shared.value)}
      unit="px"
      min={0}
      max={1920}
      onCommit={commit}
      onReset={shared.value && !shared.mixed ? () => commitCss(target, 'padding', '', localize('Padding', '内边距')) : undefined}
    />
  );
}
